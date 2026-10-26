import "server-only";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiProposals, categories, tags, transactions } from "@/db/schema";
import { createTarget } from "@/lib/finance/targets";
import { applyRules, createRule, listRules, updateRule } from "@/lib/rules/store";
import { addMemory } from "./memory";
import {
  memoryProposalPayload,
  proposalPreview,
  targetProposalPayload,
  type AnyProposalView,
  type MemoryProposalPayload,
  type TargetProposalPayload,
  ruleProposalPayload,
  type Confidence,
  type ProposalPreview,
  type ProposalView,
  type RuleProposalPayload,
} from "./proposal-types";
import { candidateRule, previewProposal, previewProposals } from "./rule-target";

export class ProposalError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

type Row = typeof aiProposals.$inferSelect;
export type NewProposal = typeof aiProposals.$inferInsert;

export interface StoredRuleProposal {
  row: Row;
  payload: RuleProposalPayload;
  preview: ProposalPreview | null;
}

export function insertProposals(db: DbLike, rows: NewProposal[]): void {
  if (rows.length === 0) return;
  db.insert(aiProposals).values(rows).run();
}

function parseRow(row: Row): StoredRuleProposal | null {
  try {
    const payload = ruleProposalPayload.parse(JSON.parse(row.payloadJson));
    const preview = row.previewJson ? proposalPreview.safeParse(JSON.parse(row.previewJson)) : null;
    return { row, payload, preview: preview?.success ? preview.data : null };
  } catch {
    return null;
  }
}

/** Rule proposals, newest first (max 200). Rows whose payload no longer parses are skipped. */
export function listProposals(
  db: DbLike,
  opts: { kind?: Row["kind"]; status?: Row["status"] | Row["status"][]; limit?: number; ids?: number[] } = {},
): StoredRuleProposal[] {
  const statuses = opts.status === undefined ? undefined : Array.isArray(opts.status) ? opts.status : [opts.status];
  return db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.kind, opts.kind ?? "rule"), statuses ? inArray(aiProposals.status, statuses) : undefined))
    .orderBy(desc(aiProposals.createdAt), desc(aiProposals.id))
    .limit(Math.min(opts.limit ?? 200, 200))
    .all()
    .flatMap((r) => parseRow(r) ?? []);
}

export function getProposal(db: DbLike, id: number): StoredRuleProposal {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  const parsed = row && parseRow(row);
  if (!parsed) throw new ProposalError("not_found", "Suggestion not found");
  return parsed;
}

/** Subject keys that already have a pending, dismissed or no_match proposal: each merchant is asked once. */
export function hasProposalFor(db: DbLike, subjectKeys: string[]): Set<string> {
  const found = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < subjectKeys.length; i += CHUNK) {
    const rows = db
      .select({ key: aiProposals.subjectKey })
      .from(aiProposals)
      .where(
        and(
          inArray(aiProposals.subjectKey, subjectKeys.slice(i, i + CHUNK)),
          inArray(aiProposals.status, ["pending", "dismissed", "no_match"]),
        ),
      )
      .all();
    for (const r of rows) if (r.key) found.add(r.key);
  }
  return found;
}

export function dismissProposal(db: DbLike, id: number, now: number): void {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  if (!row) throw new ProposalError("not_found", "Suggestion not found");
  if (row.status !== "pending") throw new ProposalError("conflict", "This suggestion was already handled.");
  db.update(aiProposals).set({ status: "dismissed", resolvedAt: now }).where(eq(aiProposals.id, id)).run();
}

/** Deletes a dismissed or no_match row so the merchant can be asked about again. */
export function forgetProposal(db: DbLike, id: number): void {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  if (!row) throw new ProposalError("not_found", "Suggestion not found");
  if (row.status !== "dismissed" && row.status !== "no_match")
    throw new ProposalError("conflict", "Only dismissed suggestions can be asked again.");
  db.delete(aiProposals).where(eq(aiProposals.id, id)).run();
}

export interface AcceptResult {
  ruleId: number;
  ruleName: string;
  mode: "extend" | "new";
  /** Existing transactions the rule filled in. */
  categorized: number;
}

/**
 * Writes the rule (extending a compatible one or creating a new one, decided against the rules as they are now),
 * optionally fills existing empty matches once, and marks the proposal accepted.
 */
export function acceptRuleProposal(
  db: DbLike,
  id: number,
  opts: { categoryId?: number; applyExisting: boolean },
  now: number,
): AcceptResult {
  return db.transaction((tx) => {
    const p = getProposal(tx, id);
    if (p.row.kind !== "rule" || p.row.status !== "pending")
      throw new ProposalError("conflict", "This suggestion was already handled.");
    let payload = p.payload;

    if (opts.categoryId !== undefined) {
      if (payload.action.type !== "category") throw new ProposalError("invalid", "Only a category can be changed.");
      const cat = tx.select().from(categories).where(eq(categories.id, opts.categoryId)).get();
      if (!cat || cat.isArchived) throw new ProposalError("invalid", "That category isn't available.");
      payload = { ...payload, action: { type: "category", categoryId: cat.id, categoryName: cat.name } };
    }

    const { rule, mode } = candidateRule(listRules(tx), payload);
    const def = {
      name: rule.name,
      match: rule.match,
      conditions: rule.conditions,
      actions: rule.actions,
      enabled: rule.enabled,
    };
    const saved = mode === "extend" ? updateRule(tx, rule.id, def) : createRule(tx, def);
    let categorized = 0;
    if (opts.applyExisting) {
      // applyRules counts split rows it deliberately leaves alone, so count the real change.
      const withCategory = (cid: number) =>
        tx.select({ n: count() }).from(transactions).where(eq(transactions.categoryId, cid)).get()?.n ?? 0;
      const cid = saved.actions.categoryId;
      const before = cid === undefined ? 0 : withCategory(cid);
      const changed = applyRules(tx, { rules: [saved], overwrite: false }).changed;
      categorized = cid === undefined ? changed : withCategory(cid) - before;
    }

    tx.update(aiProposals)
      .set({ status: "accepted", resolvedAt: now, ruleId: saved.id })
      .where(eq(aiProposals.id, id))
      .run();
    if (p.row.subjectKey)
      tx.update(aiProposals)
        .set({ status: "stale", resolvedAt: now })
        .where(
          and(eq(aiProposals.subjectKey, p.row.subjectKey), eq(aiProposals.status, "pending"), ne(aiProposals.id, id)),
        )
        .run();
    return { ruleId: saved.id, ruleName: saved.name, mode, categorized };
  });
}

const RANK: Confidence[] = ["low", "medium", "high"];

export interface AcceptAllResult {
  accepted: number;
  skipped: number;
  categorized: number;
}

/** Accepts every pending rule proposal at or above `minConfidence` whose fresh preview has no conflicts. */
export function acceptAll(
  db: DbLike,
  opts: { minConfidence: "high" | "medium"; applyExisting: boolean },
  now: number,
  timeZone: string,
): AcceptAllResult {
  const out: AcceptAllResult = { accepted: 0, skipped: 0, categorized: 0 };
  const pending = listProposals(db, { status: "pending" }).reverse(); // creation order
  for (const p of pending) {
    const ok =
      p.row.confidence !== null &&
      RANK.indexOf(p.row.confidence) >= RANK.indexOf(opts.minConfidence) &&
      previewProposal(db, p.payload, timeZone).conflicts === 0;
    if (!ok) {
      out.skipped++;
      continue;
    }
    try {
      out.categorized += acceptRuleProposal(db, p.row.id, { applyExisting: opts.applyExisting }, now).categorized;
      out.accepted++;
    } catch {
      out.skipped++; // e.g. the category was deleted since the suggestion was made
    }
  }
  return out;
}

/** What the Rules page shows: pending items get a fresh preview and a check that their category/tag still exists. */
export function listProposalViews(
  db: DbLike,
  opts: { kind?: Row["kind"]; status?: Row["status"] | Row["status"][]; ids?: number[] },
  timeZone: string,
): ProposalView[] {
  const items = listProposals(db, opts);
  const pending = items.filter((p) => p.row.status === "pending");
  const fresh = new Map(
    previewProposals(
      db,
      pending.map((p) => p.payload),
      timeZone,
    ).map((v, i) => [pending[i].row.id, v]),
  );
  const liveCategories = new Set(
    db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.isArchived, false))
      .all()
      .map((c) => c.id),
  );
  const liveTags = new Set(
    db
      .select({ id: tags.id })
      .from(tags)
      .all()
      .map((t) => t.id),
  );
  return items.map(({ row, payload, preview }) => {
    const a = payload.action;
    const valid = a.type === "category" ? liveCategories.has(a.categoryId) : liveTags.has(a.tagId);
    return {
      id: row.id,
      kind: "rule" as const,
      status: row.status,
      confidence: row.confidence,
      model: row.model,
      createdAt: row.createdAt,
      threadId: row.threadId,
      payload,
      preview: fresh.get(row.id) ?? preview,
      stillValid: valid,
      ...(valid
        ? {}
        : { problem: `The ${a.type} "${a.type === "category" ? a.categoryName : a.tagName}" no longer exists.` }),
    };
  });
}

export function insertProposal(db: DbLike, row: NewProposal): number {
  return db.insert(aiProposals).values(row).returning({ id: aiProposals.id }).get().id;
}

type AnyRow = typeof aiProposals.$inferSelect;

/** One proposal of any kind as the UI sees it. Rule previews are recomputed while pending. */
export function viewOf(db: DbLike, row: AnyRow, timeZone: string): AnyProposalView | null {
  const base = {
    id: row.id,
    status: row.status,
    confidence: row.confidence,
    model: row.model,
    createdAt: row.createdAt,
    threadId: row.threadId,
  };
  try {
    const json: unknown = JSON.parse(row.payloadJson);
    if (row.kind === "rule") {
      return listProposalViews(db, { kind: "rule", ids: [row.id] }, timeZone)[0] ?? null;
    }
    if (row.kind === "memory") {
      return { ...base, kind: "memory", payload: memoryProposalPayload.parse(json), stillValid: true };
    }
    const payload = targetProposalPayload.parse(json);
    const cat = db.select().from(categories).where(eq(categories.id, payload.categoryId)).get();
    const valid = !!cat && !cat.isArchived;
    return {
      ...base,
      kind: "target",
      payload,
      stillValid: valid,
      ...(valid ? {} : { problem: `The category "${payload.categoryName}" no longer exists.` }),
    };
  } catch {
    return null;
  }
}

/** Every proposal made in a conversation (any kind, any status), oldest first. */
export function listThreadProposals(db: DbLike, threadId: number, timeZone: string): AnyProposalView[] {
  const rows = db.select().from(aiProposals).where(eq(aiProposals.threadId, threadId)).orderBy(aiProposals.id).all();
  const ruleIds = rows.filter((r) => r.kind === "rule").map((r) => r.id);
  const rules = ruleIds.length ? listProposalViews(db, { kind: "rule", ids: ruleIds }, timeZone) : [];
  return rows.flatMap((r) =>
    r.kind === "rule" ? (rules.find((v) => v.id === r.id) ?? []) : (viewOf(db, r, timeZone) ?? []),
  );
}

export function getProposalView(db: DbLike, id: number, timeZone: string): AnyProposalView {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  const view = row && viewOf(db, row, timeZone);
  if (!view) throw new ProposalError("not_found", "Suggestion not found");
  return view;
}

function loadPending(tx: DbLike, id: number, kind: AnyRow["kind"]): AnyRow {
  const row = tx.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  if (!row) throw new ProposalError("not_found", "Suggestion not found");
  if (row.kind !== kind || row.status !== "pending")
    throw new ProposalError("conflict", "This suggestion was already handled.");
  return row;
}

export function acceptMemoryProposal(db: DbLike, id: number, now: number): { memoryId: number } {
  return db.transaction((tx) => {
    const row = loadPending(tx, id, "memory");
    const payload: MemoryProposalPayload = memoryProposalPayload.parse(JSON.parse(row.payloadJson));
    const memory = addMemory(tx, payload.text, "assistant", now);
    tx.update(aiProposals).set({ status: "accepted", resolvedAt: now }).where(eq(aiProposals.id, id)).run();
    return { memoryId: memory.id };
  });
}

/** A recurring (every month) category target through the normal target code. */
export function acceptTargetProposal(db: DbLike, id: number, now: number): { targetId: number } {
  return db.transaction((tx) => {
    const row = loadPending(tx, id, "target");
    const payload: TargetProposalPayload = targetProposalPayload.parse(JSON.parse(row.payloadJson));
    const target = createTarget(tx, {
      kind: "category",
      subjectId: payload.categoryId,
      amountCents: payload.amountCents,
    });
    tx.update(aiProposals).set({ status: "accepted", resolvedAt: now }).where(eq(aiProposals.id, id)).run();
    return { targetId: target.id };
  });
}

export type AcceptAnyResult =
  (AcceptResult & { kind: "rule" }) | { kind: "memory"; memoryId: number } | { kind: "target"; targetId: number };

/** Applies a proposal through the normal code path for its kind. */
export function acceptProposal(
  db: DbLike,
  id: number,
  opts: { categoryId?: number; applyExisting: boolean },
  now: number,
): AcceptAnyResult {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  if (!row) throw new ProposalError("not_found", "Suggestion not found");
  if (row.kind === "memory") return { kind: "memory", ...acceptMemoryProposal(db, id, now) };
  if (row.kind === "target") return { kind: "target", ...acceptTargetProposal(db, id, now) };
  return { kind: "rule", ...acceptRuleProposal(db, id, opts, now) };
}
