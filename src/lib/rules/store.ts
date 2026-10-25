import { eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, categories, rules as rulesTable, tags, transactionTags, transactions } from "@/db/schema";
import { effectiveDateSql } from "@/lib/finance/sql";
import { planChangesTarget, planForTransaction, type RulePlan, type RuleTarget } from "./engine";
import {
  actionsSchema,
  conditionSchema,
  ruleInputSchema,
  type Rule,
  type RuleDefinition,
  type RuleInput,
} from "./types";
import { z } from "zod";

export class RuleError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

type Row = typeof rulesTable.$inferSelect;

/** Parses a stored row; rows that no longer validate are skipped rather than breaking every sync. */
function toRule(row: Row): Rule | null {
  try {
    const conditions = z.array(conditionSchema).min(1).parse(JSON.parse(row.conditionsJson));
    const actions = actionsSchema.parse(JSON.parse(row.actionsJson));
    return {
      id: row.id,
      name: row.name,
      priority: row.priority,
      enabled: row.enabled,
      match: row.match,
      conditions,
      actions,
    };
  } catch {
    return null;
  }
}

export function listRules(db: DbLike): Rule[] {
  return db
    .select()
    .from(rulesTable)
    .orderBy(rulesTable.priority, rulesTable.id)
    .all()
    .flatMap((r) => toRule(r) ?? []);
}

export function getRule(db: DbLike, id: number): Rule | undefined {
  const row = db.select().from(rulesTable).where(eq(rulesTable.id, id)).get();
  return row ? (toRule(row) ?? undefined) : undefined;
}

function assertReferences(db: DbLike, def: Pick<RuleDefinition, "actions" | "conditions">) {
  const { categoryId, addTagIds } = def.actions;
  if (
    categoryId !== undefined &&
    !db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).get()
  ) {
    throw new RuleError("invalid", "That category no longer exists");
  }
  const tagIds = [...new Set(addTagIds ?? [])];
  if (
    tagIds.length &&
    db.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds)).all().length !== tagIds.length
  ) {
    throw new RuleError("invalid", "One of the tags no longer exists");
  }
  for (const c of def.conditions) {
    if (c.field === "account" && !db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, c.value)).get()) {
      throw new RuleError("invalid", "That account no longer exists");
    }
  }
}

const serialize = (def: RuleDefinition) => ({
  name: def.name,
  match: def.match,
  enabled: def.enabled,
  conditionsJson: JSON.stringify(def.conditions),
  actionsJson: JSON.stringify(def.actions),
});

/** New rules go to the end of the priority order. Validates the input and that referenced rows exist. */
export function createRule(db: DbLike, input: RuleInput): Rule {
  const def = ruleInputSchema.parse(input);
  assertReferences(db, def);
  const next =
    (db
      .select({ m: sql<number>`coalesce(max(${rulesTable.priority}), -1)` })
      .from(rulesTable)
      .get()?.m ?? -1) + 1;
  const row = db
    .insert(rulesTable)
    .values({ ...serialize(def), priority: next })
    .returning()
    .get();
  return toRule(row)!;
}

export function updateRule(db: DbLike, id: number, input: RuleInput): Rule {
  const def = ruleInputSchema.parse(input);
  assertReferences(db, def);
  const row = db.update(rulesTable).set(serialize(def)).where(eq(rulesTable.id, id)).returning().get();
  if (!row) throw new RuleError("not_found", "Rule not found");
  return toRule(row)!;
}

export function setRuleEnabled(db: DbLike, id: number, enabled: boolean): void {
  if (
    db.update(rulesTable).set({ enabled }).where(eq(rulesTable.id, id)).returning({ id: rulesTable.id }).all()
      .length === 0
  ) {
    throw new RuleError("not_found", "Rule not found");
  }
}

export function deleteRule(db: DbLike, id: number): boolean {
  return db.delete(rulesTable).where(eq(rulesTable.id, id)).returning({ id: rulesTable.id }).all().length > 0;
}

/**
 * Sets priorities from `ids` (first runs first). A slightly stale list is fine: unknown ids are ignored and rules
 * that aren't listed keep their relative order after the listed ones.
 */
export function reorderRules(db: DbLike, ids: number[]): void {
  if (new Set(ids).size !== ids.length) throw new RuleError("invalid", "Each rule can only be listed once");
  const existing = db
    .select({ id: rulesTable.id })
    .from(rulesTable)
    .orderBy(rulesTable.priority, rulesTable.id)
    .all()
    .map((r) => r.id);
  const known = new Set(existing);
  const order = [...ids.filter((id) => known.has(id)), ...existing.filter((id) => !ids.includes(id))];
  db.transaction((tx) =>
    order.forEach((id, i) => tx.update(rulesTable).set({ priority: i }).where(eq(rulesTable.id, id)).run()),
  );
}

// ── applying rules ──────────────────────────────────────────────────────────

interface LoadedTarget {
  target: RuleTarget;
  /** Effective date, for choosing the most recent samples. */
  at: number;
}

const CHUNK = 500;

/** Loads the fields rules look at (and the current tags) for the given ids, or for every transaction. */
export function loadTargets(db: DbLike, ids?: number[]): LoadedTarget[] {
  const out: LoadedTarget[] = [];
  const load = (chunk?: number[]) => {
    const rows = db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        description: transactions.description,
        payee: transactions.payee,
        payeeOverride: transactions.payeeOverride,
        amountCents: transactions.amountCents,
        categoryId: transactions.categoryId,
        isTransfer: transactions.isTransfer,
        isExcluded: transactions.isExcluded,
        at: effectiveDateSql,
      })
      .from(transactions)
      .where(chunk ? inArray(transactions.id, chunk) : undefined)
      .all();
    const links = db
      .select({ transactionId: transactionTags.transactionId, tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(chunk ? inArray(transactionTags.transactionId, chunk) : undefined)
      .all();
    const tagMap = new Map<number, number[]>();
    for (const l of links)
      (tagMap.get(l.transactionId) ?? tagMap.set(l.transactionId, []).get(l.transactionId)!).push(l.tagId);
    for (const { at, ...r } of rows) out.push({ at, target: { ...r, tagIds: tagMap.get(r.id) ?? [] } });
  };
  if (!ids) load();
  else for (let i = 0; i < ids.length; i += CHUNK) load(ids.slice(i, i + CHUNK));
  return out;
}

export interface ApplyOptions {
  /** Only these rules (default: every enabled rule). They still run in priority order. */
  rules?: Rule[];
  /** Restrict to these transactions (default: all). */
  ids?: number[];
  /** Replace values the user (or an earlier import) already set. Default false: only fill empty fields. */
  overwrite?: boolean;
  /** Compute the outcome without writing anything. */
  dryRun?: boolean;
  /** How many of the most recent matching ids to return. */
  sample?: number;
}

export interface ApplyResult {
  /** Transactions at least one rule matched. */
  matched: number;
  /** Transactions that were (or, for a dry run, would be) modified. */
  changed: number;
  sampleIds: number[];
}

function writePlan(db: DbLike, t: RuleTarget, plan: RulePlan, valid: { categories: Set<number>; tags: Set<number> }) {
  const set: Partial<typeof transactions.$inferInsert> = {};
  if (plan.categoryId !== undefined && valid.categories.has(plan.categoryId)) set.categoryId = plan.categoryId;
  if (plan.payeeOverride !== undefined) set.payeeOverride = plan.payeeOverride;
  if (plan.markTransfer) set.isTransfer = true;
  if (plan.exclude) set.isExcluded = true;
  if (Object.keys(set).length)
    db.update(transactions)
      .set({ ...set, updatedAt: sql`(unixepoch())` })
      .where(eq(transactions.id, t.id))
      .run();
  for (const tagId of plan.addTagIds) {
    if (valid.tags.has(tagId))
      db.insert(transactionTags).values({ transactionId: t.id, tagId }).onConflictDoNothing().run();
  }
}

/** Runs rules over existing transactions (on demand, on new imports, or as a preview). */
export function applyRules(db: DbLike, opts: ApplyOptions = {}): ApplyResult {
  const rules = (opts.rules ?? listRules(db).filter((r) => r.enabled))
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  const result: ApplyResult = { matched: 0, changed: 0, sampleIds: [] };
  if (rules.length === 0) return result;

  const targets = loadTargets(db, opts.ids);
  const valid = {
    categories: new Set(
      db
        .select({ id: categories.id })
        .from(categories)
        .all()
        .map((c) => c.id),
    ),
    tags: new Set(
      db
        .select({ id: tags.id })
        .from(tags)
        .all()
        .map((t) => t.id),
    ),
  };
  const matchedAt: Array<{ id: number; at: number }> = [];

  const run = (tx: DbLike) => {
    for (const { target, at } of targets) {
      const plan = planForTransaction(rules, target, { overwrite: opts.overwrite });
      if (!plan) continue;
      result.matched++;
      matchedAt.push({ id: target.id, at });
      if (!planChangesTarget(plan, target)) continue;
      result.changed++;
      if (!opts.dryRun) writePlan(tx, target, plan, valid);
    }
  };
  if (opts.dryRun) run(db);
  else db.transaction((tx) => run(tx));

  result.sampleIds = matchedAt
    .sort((a, b) => b.at - a.at || b.id - a.id)
    .slice(0, opts.sample ?? 0)
    .map((m) => m.id);
  return result;
}

/** Rules for freshly imported transactions: fill empty fields only. Cheap no-op when there are no rules. */
export function applyRulesToNew(db: DbLike, ids: number[]): ApplyResult {
  if (ids.length === 0) return { matched: 0, changed: 0, sampleIds: [] };
  return applyRules(db, { ids, overwrite: false });
}

/** "Matches N existing transactions" for a rule that may not be saved yet. */
export function previewRule(
  db: DbLike,
  draft: RuleInput,
  opts: { overwrite?: boolean; sample?: number } = {},
): ApplyResult {
  const def = ruleInputSchema.parse(draft);
  const rule: Rule = { ...def, id: 0, priority: 0, enabled: true };
  return applyRules(db, { rules: [rule], overwrite: opts.overwrite, dryRun: true, sample: opts.sample ?? 8 });
}

// ── keeping rules consistent when categories, tags or accounts change ───────

/**
 * Points rules at another category (merge) or drops the category from their actions (delete). A rule left with no
 * actions is removed. Returns how many rules were rewritten and removed.
 */
export function scrubCategoryFromRules(
  db: DbLike,
  from: number,
  to: number | null,
): { rewritten: number; removed: number } {
  return rewriteActions(db, (a) => {
    if (a.categoryId !== from) return a;
    const { categoryId: _drop, ...rest } = a;
    void _drop;
    return to === null ? rest : { ...rest, categoryId: to };
  });
}

export function scrubTagFromRules(db: DbLike, tagId: number): { rewritten: number; removed: number } {
  return rewriteActions(db, (a) => {
    if (!a.addTagIds?.includes(tagId)) return a;
    const { addTagIds, ...rest } = a;
    const left = addTagIds.filter((t) => t !== tagId);
    return left.length ? { ...rest, addTagIds: left } : rest;
  });
}

function rewriteActions(db: DbLike, fn: (a: Rule["actions"]) => Rule["actions"]) {
  let rewritten = 0;
  let removed = 0;
  for (const row of db.select().from(rulesTable).all()) {
    let actions: unknown;
    try {
      actions = JSON.parse(row.actionsJson);
    } catch {
      continue;
    }
    const before = JSON.stringify(actions);
    const after = fn(actions as Rule["actions"]);
    if (JSON.stringify(after) === before) continue;
    if (actionsSchema.safeParse(after).success) {
      db.update(rulesTable)
        .set({ actionsJson: JSON.stringify(after) })
        .where(eq(rulesTable.id, row.id))
        .run();
      rewritten++;
    } else {
      db.delete(rulesTable).where(eq(rulesTable.id, row.id)).run();
      removed++;
    }
  }
  return { rewritten, removed };
}

/** Rules that compare against an account that is being removed can no longer match; remove them. */
export function removeRulesForAccounts(db: DbLike, accountIds: string[]): number {
  let removed = 0;
  for (const rule of listRules(db)) {
    if (rule.conditions.some((c) => c.field === "account" && accountIds.includes(c.value))) {
      deleteRule(db, rule.id);
      removed++;
    }
  }
  return removed;
}
