import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, transactions } from "@/db/schema";
import { DAY } from "./dates";

/** Opposite-sign matches must land within this many days of each other. */
export const TRANSFER_WINDOW_DAYS = 4;

/** Typical wording for a credit card payment as it appears on the card's side. */
export const PAYMENT_PATTERN = /(payment|autopay|transfer|xfer|zelle to self|online banking transfer)/i;

type Txn = typeof transactions.$inferSelect;

function candidatesFor(db: DbLike, t: Pick<Txn, "id" | "accountId" | "amountCents" | "posted">): Txn[] {
  const window = TRANSFER_WINDOW_DAYS * DAY;
  return db
    .select()
    .from(transactions)
    .where(
      and(
        ne(transactions.accountId, t.accountId),
        eq(transactions.amountCents, -t.amountCents),
        eq(transactions.pending, false),
        isNull(transactions.transferPairId),
        sql`abs(${transactions.posted} - ${t.posted}) <= ${window}`,
      ),
    )
    .all();
}

export interface TransferResult {
  paired: number;
  flagged: number;
}

/**
 * Looks for opposite-sign, same-amount transactions in a *different* account within ±4 days.
 * A pair is only made when the match is unambiguous in both directions (exactly one candidate
 * each way). Credit card payments with no counterpart are still flagged by their description.
 * Only unpaired, posted transactions are considered, so running it twice is harmless.
 */
export function detectTransfers(db: DbLike, ids: number[]): TransferResult {
  const result: TransferResult = { paired: 0, flagged: 0 };
  if (ids.length === 0) return result;

  for (const id of new Set(ids)) {
    const t = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!t || t.pending || t.transferPairId !== null) continue;

    const candidates = candidatesFor(db, t);
    if (candidates.length === 1) {
      const other = candidates[0];
      const reciprocal = candidatesFor(db, other);
      if (reciprocal.length === 1 && reciprocal[0].id === t.id) {
        db.update(transactions)
          .set({ isTransfer: true, transferPairId: other.id, updatedAt: sql`(unixepoch())` })
          .where(eq(transactions.id, t.id))
          .run();
        db.update(transactions)
          .set({ isTransfer: true, transferPairId: t.id, updatedAt: sql`(unixepoch())` })
          .where(eq(transactions.id, other.id))
          .run();
        result.paired++;
        continue;
      }
    }

    if (!t.isTransfer && t.amountCents > 0 && PAYMENT_PATTERN.test(t.description)) {
      const account = db.select({ type: accounts.type }).from(accounts).where(eq(accounts.id, t.accountId)).get();
      if (account?.type === "credit") {
        db.update(transactions)
          .set({ isTransfer: true, updatedAt: sql`(unixepoch())` })
          .where(eq(transactions.id, t.id))
          .run();
        result.flagged++;
      }
    }
  }
  return result;
}

/** Manually unpairs a transfer (both sides) and clears the flag on both. */
export function unpairTransfer(db: DbLike, id: number): void {
  const t = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!t) return;
  const ids = [t.id, ...(t.transferPairId ? [t.transferPairId] : [])];
  db.update(transactions)
    .set({ isTransfer: false, transferPairId: null, updatedAt: sql`(unixepoch())` })
    .where(inArray(transactions.id, ids))
    .run();
}
