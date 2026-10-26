import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { categories, transactions } from "@/db/schema";
import { formatCents } from "@/lib/finance/cents";
import { normalizePayee, payeeKey } from "@/lib/finance/payee";
import { noSplitsSql } from "@/lib/finance/sql";
import { createRule, listRules } from "@/lib/rules/store";
import type { LlmClient } from "./types";

// The manual, bulk "let the model categorize what the rules missed" job. It never runs on its own: the CLI
// (`pnpm ai:categorize`) drives it. Cost control comes from working per distinct payee, not per transaction.

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** All the uncategorized transactions that share one merchant. */
export interface PayeeGroup {
  /** Position in the batch list; this is what the model echoes back. */
  index: number;
  key: string;
  payee: string;
  /** One raw bank description, in case the cleaned payee is too terse. */
  sample: string;
  direction: "expense" | "income";
  count: number;
  /** Typical amount in cents (absolute). */
  medianCents: number;
  ids: number[];
}

export interface Proposal {
  key: string;
  payee: string;
  categoryId: number;
  categoryName: string;
  confidence: Confidence;
  direction: "expense" | "income";
  count: number;
  ids: number[];
}

export interface CategoryChoice {
  id: number;
  name: string;
  isIncome: boolean;
}

export function listCategoryChoices(db: DbLike): CategoryChoice[] {
  return db
    .select({ id: categories.id, name: categories.name, isIncome: categories.isIncome })
    .from(categories)
    .where(eq(categories.isArchived, false))
    .orderBy(asc(categories.sortOrder), asc(categories.id))
    .all();
}

/** Uncategorized, unsplit, non-transfer, non-excluded transactions grouped by merchant; the biggest groups first. */
export function collectUncategorized(db: DbLike, opts: { maxGroups?: number } = {}): PayeeGroup[] {
  const rows = db
    .select({
      id: transactions.id,
      description: transactions.description,
      payee: transactions.payee,
      payeeOverride: transactions.payeeOverride,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.categoryId),
        eq(transactions.isTransfer, false),
        eq(transactions.isExcluded, false),
        noSplitsSql,
      ),
    )
    .orderBy(sql`${transactions.posted} desc`, sql`${transactions.id} desc`)
    .all();

  const byKey = new Map<string, Omit<PayeeGroup, "index" | "medianCents"> & { amounts: number[] }>();
  for (const r of rows) {
    const payee = normalizePayee(r.payeeOverride?.trim() || r.payee?.trim() || r.description) || r.description;
    const direction = r.amountCents > 0 ? "income" : "expense";
    // Money in and money out from the same merchant (a purchase and its refund) are different questions.
    const key = `${direction}:${payeeKey(payee) || "unknown"}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, payee, sample: r.description, direction, count: 0, ids: [], amounts: [] };
      byKey.set(key, g);
    }
    g.count++;
    g.ids.push(r.id);
    g.amounts.push(Math.abs(r.amountCents));
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, opts.maxGroups ?? Infinity)
    .map(({ amounts, ...g }, index) => {
      amounts.sort((a, b) => a - b);
      return { ...g, index, medianCents: amounts[Math.floor(amounts.length / 2)] };
    });
}

export const SYSTEM_PROMPT = `You categorize bank transactions for a personal-budget app.
You are given a list of payees and a fixed list of categories. For every payee choose exactly one category from that list, spelled exactly as written.
- "expense" payees are money going out; "income" payees are money coming in (income categories usually fit, but a refund belongs to the category of what was bought).
- Judge confidence honestly: "high" only when the merchant clearly belongs there, "low" when you are guessing. Use "low" rather than a wild guess.
- Reply with JSON only, no prose: an array of {"i": <payee number>, "category": "<name>", "confidence": "high"|"medium"|"low"}.`;

export function buildBatchPrompt(groups: PayeeGroup[], choices: CategoryChoice[]): string {
  const cats = choices.map((c) => `- ${c.name}${c.isIncome ? " (income)" : ""}`).join("\n");
  const lines = groups.map(
    (g) =>
      `${g.index}. ${g.payee}${g.sample !== g.payee ? ` [bank text: ${g.sample.slice(0, 80)}]` : ""} | ${g.direction} | ~${formatCents(g.medianCents)} | ${g.count}x`,
  );
  return `Categories:\n${cats}\n\nPayees (number. name | direction | typical amount | how many):\n${lines.join("\n")}`;
}

/** Rough token estimate (≈4 characters per token) for the cost preview. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Tolerant of code fences and chatter around the array. Rows that don't check out are dropped, never guessed at. */
export function parseBatchResponse(
  text: string,
  groups: PayeeGroup[],
  choices: CategoryChoice[],
): { proposals: Proposal[]; rejected: number } {
  const byName = new Map(choices.map((c) => [c.name.trim().toLowerCase(), c]));
  const byIndex = new Map(groups.map((g) => [g.index, g]));
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let raw: unknown;
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return { proposals: [], rejected: groups.length };

  const seen = new Set<number>();
  const proposals: Proposal[] = [];
  let rejected = 0;
  for (const item of raw as Array<Record<string, unknown>>) {
    const group = typeof item?.i === "number" ? byIndex.get(item.i) : undefined;
    const choice = typeof item?.category === "string" ? byName.get(item.category.trim().toLowerCase()) : undefined;
    const confidence = CONFIDENCES.find((c) => c === item?.confidence);
    if (!group || !choice || !confidence || seen.has(group.index)) {
      rejected++;
      continue;
    }
    seen.add(group.index);
    proposals.push({
      key: group.key,
      payee: group.payee,
      categoryId: choice.id,
      categoryName: choice.name,
      confidence,
      direction: group.direction,
      count: group.count,
      ids: group.ids,
    });
  }
  return { proposals, rejected };
}

export interface ProposeOptions {
  batchSize: number;
  /** Hard cap on model calls; groups beyond it are left for the next run. */
  maxCalls: number;
  onBatch?: (info: { call: number; calls: number; groups: number }) => void;
  signal?: AbortSignal;
}

export interface ProposeResult {
  proposals: Proposal[];
  /** Groups the model skipped or answered with something unusable. */
  unresolved: PayeeGroup[];
  calls: number;
  /** Groups not sent because of `maxCalls`. */
  deferred: number;
}

export async function proposeCategories(
  llm: LlmClient,
  groups: PayeeGroup[],
  choices: CategoryChoice[],
  opts: ProposeOptions,
): Promise<ProposeResult> {
  const batches: PayeeGroup[][] = [];
  for (let i = 0; i < groups.length; i += opts.batchSize) batches.push(groups.slice(i, i + opts.batchSize));
  const sent = batches.slice(0, opts.maxCalls);
  const result: ProposeResult = {
    proposals: [],
    unresolved: [],
    calls: 0,
    deferred: batches.slice(opts.maxCalls).reduce((n, b) => n + b.length, 0),
  };
  for (const [n, batch] of sent.entries()) {
    opts.onBatch?.({ call: n + 1, calls: sent.length, groups: batch.length });
    const text = await llm.generate({
      system: SYSTEM_PROMPT,
      user: buildBatchPrompt(batch, choices),
      maxTokens: Math.max(400, batch.length * 40),
      signal: opts.signal,
    });
    result.calls++;
    const { proposals } = parseBatchResponse(text, batch, choices);
    const answered = new Set(proposals.map((p) => p.key));
    result.proposals.push(...proposals);
    result.unresolved.push(...batch.filter((g) => !answered.has(g.key)));
  }
  return result;
}

export interface ApplyProposalsOptions {
  /** Lowest confidence that gets written. */
  minConfidence: Confidence;
  /** Also create a "payee is X → category" rule so future syncs categorize this merchant for free. */
  makeRules: boolean;
}

export interface ApplyProposalsResult {
  transactionsUpdated: number;
  groupsApplied: number;
  groupsSkipped: number;
  rulesCreated: number;
}

const rank = (c: Confidence) => CONFIDENCES.indexOf(c);
const CHUNK = 500;

/** Writes the proposals. Only fills empty categories: anything categorized since the proposals were made is left alone. */
export function applyProposals(db: DbLike, proposals: Proposal[], opts: ApplyProposalsOptions): ApplyProposalsResult {
  const out: ApplyProposalsResult = { transactionsUpdated: 0, groupsApplied: 0, groupsSkipped: 0, rulesCreated: 0 };
  const validCategories = new Set(listCategoryChoices(db).map((c) => c.id));
  const existingRules = opts.makeRules ? listRules(db) : [];

  db.transaction((tx) => {
    for (const p of proposals) {
      if (rank(p.confidence) < rank(opts.minConfidence) || !validCategories.has(p.categoryId)) {
        out.groupsSkipped++;
        continue;
      }
      let changed = 0;
      for (let i = 0; i < p.ids.length; i += CHUNK) {
        changed += tx
          .update(transactions)
          .set({ categoryId: p.categoryId, updatedAt: sql`(unixepoch())` })
          .where(and(inArray(transactions.id, p.ids.slice(i, i + CHUNK)), isNull(transactions.categoryId), noSplitsSql))
          .run().changes;
      }
      out.transactionsUpdated += changed;
      out.groupsApplied++;

      if (opts.makeRules && changed > 0 && p.payee.trim()) {
        const duplicate = existingRules.some((r) =>
          r.conditions.some((c) => c.field === "payee" && c.op === "equals" && payeeKey(c.value) === payeeKey(p.payee)),
        );
        if (!duplicate) {
          createRule(tx, {
            name: `AI: ${p.payee}`.slice(0, 120),
            match: "all",
            conditions: [
              { field: "payee", op: "equals", value: p.payee },
              { field: "direction", op: "equals", value: p.direction },
            ],
            actions: { categoryId: p.categoryId },
          });
          out.rulesCreated++;
        }
      }
    }
  });
  return out;
}
