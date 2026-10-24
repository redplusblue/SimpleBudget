import { and, eq, notInArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { transactionTags, transactions } from "@/db/schema";
import { DAY } from "@/lib/finance/dates";
import type { Window } from "./limits";

type Txn = typeof transactions.$inferSelect;

/** Pending items older than this that the bank no longer reports are dropped regardless of window. */
const STALE_PENDING_DAYS = 21;
/** A posted transaction inherits a vanished pending one's edits if it lands within this many days. */
const MATCH_DAYS = 5;
const PREFIX_LEN = 10;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Normalized prefix match": the shorter description (capped at 10 chars) must prefix the longer. */
export function descriptionsSimilar(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  const n = Math.min(PREFIX_LEN, x.length, y.length);
  return n >= 3 && x.slice(0, n) === y.slice(0, n);
}

/** When a pending transaction happened (it has no posted date yet). */
export function pendingDate(t: Pick<Txn, "transactedAt" | "posted" | "importedAt">): number {
  return t.transactedAt || t.posted || t.importedAt;
}

function hasUserEdits(db: DbLike, t: Txn): boolean {
  if (t.categoryId !== null || t.notes !== null || t.payeeOverride !== null || t.isExcluded) return true;
  return !!db.select().from(transactionTags).where(eq(transactionTags.transactionId, t.id)).get();
}

export interface ReconcileResult {
  removed: number;
  moved: number;
}

/**
 * Removes pending rows the bank no longer reports (they posted under a new id, or were dropped).
 * If such a row carried user edits, they're moved to the freshly imported posted transaction that
 * looks like the same purchase (same amount, within ±5 days, similar description); otherwise the
 * edits are lost with the row.
 *
 * @param seen sfTxnIds present in this response for the account
 * @param runStart unix seconds when the sync began; only rows imported since then are candidates
 */
export function reconcilePending(
  db: DbLike,
  accountId: string,
  seen: Set<string>,
  window: Window,
  now: number,
  runStart: number,
): ReconcileResult {
  const result: ReconcileResult = { removed: 0, moved: 0 };
  const stale = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.pending, true),
        seen.size ? notInArray(transactions.sfTxnId, [...seen]) : undefined,
      ),
    )
    .all()
    .filter((t) => {
      const d = pendingDate(t);
      return (d >= window.start && d <= window.end) || d < now - STALE_PENDING_DAYS * DAY;
    });

  for (const p of stale) {
    if (hasUserEdits(db, p)) {
      const target = pickPostedMatch(db, p, runStart);
      if (target) {
        db.update(transactions)
          .set({
            categoryId: p.categoryId,
            notes: p.notes,
            payeeOverride: p.payeeOverride,
            isExcluded: p.isExcluded,
            isReviewed: p.isReviewed,
            updatedAt: sql`(unixepoch())`,
          })
          .where(eq(transactions.id, target.id))
          .run();
        db.update(transactionTags)
          .set({ transactionId: target.id })
          .where(eq(transactionTags.transactionId, p.id))
          .run();
        result.moved++;
      }
    }
    db.delete(transactions).where(eq(transactions.id, p.id)).run();
    result.removed++;
  }
  return result;
}

function pickPostedMatch(db: DbLike, p: Txn, runStart: number): Txn | undefined {
  const d = pendingDate(p);
  const candidates = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, p.accountId),
        eq(transactions.pending, false),
        eq(transactions.amountCents, p.amountCents),
        sql`${transactions.importedAt} >= ${runStart}`,
        sql`abs(${transactions.posted} - ${d}) <= ${MATCH_DAYS * DAY}`,
      ),
    )
    .all()
    .filter((c) => descriptionsSimilar(c.description, p.description) && !hasUserEdits(db, c));
  if (candidates.length === 0) return undefined;
  const ranked = candidates.map((c) => ({ c, gap: Math.abs(c.posted - d) })).sort((a, b) => a.gap - b.gap);
  // Ambiguous (two equally close purchases): don't guess.
  if (ranked.length > 1 && ranked[0].gap === ranked[1].gap) return undefined;
  return ranked[0].c;
}
