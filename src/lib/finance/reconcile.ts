import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { accounts, transactions } from "@/db/schema";
import { addDaysToDate, isDateString, zonedDayStart } from "./dates";

export class ReconcileError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const reconcileSchema = z.object({
  /** The statement's end date, `YYYY-MM-DD`. */
  date: z.string().refine(isDateString, "Enter the statement date"),
  /** What the bank or statement says the balance was at the end of that day. */
  balanceCents: z.number().int(),
  /** Also mark every posted transaction up to that date as reviewed. */
  markReviewed: z.boolean().optional(),
});

export interface ReconcileResult {
  date: string;
  /** What the bank says (as typed). */
  bankCents: number;
  /** What the transactions here add up to at the end of that day. */
  appCents: number;
  /** bank - app. Zero means they agree. */
  differenceCents: number;
  matches: boolean;
  /** Posted transactions up to that date that haven't been reviewed yet. */
  unreviewedCount: number;
  /** Transactions marked reviewed by this call. */
  markedReviewed: number;
  /** Pending items are ignored, because banks leave them out of the balance. */
  pendingCount: number;
}

/**
 * The balance the app's own records imply at the end of `date`: today's balance minus everything posted after that
 * day. (Pending items are left out, like the bank does.)
 */
export function balanceAtEndOfDay(db: DbLike, accountId: string, date: string, timeZone: string): number {
  const account = db.select({ balance: accounts.balanceCents }).from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new ReconcileError("not_found", "Account not found");
  const after = zonedDayStart(addDaysToDate(date, 1), timeZone);
  const newer =
    db
      .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(transactions)
      .where(
        and(eq(transactions.accountId, accountId), eq(transactions.pending, false), gt(transactions.posted, after - 1)),
      )
      .get()?.total ?? 0;
  return account.balance - newer;
}

/** "Bank says $X, app says $Y" for the end of a statement day, optionally marking everything up to then reviewed. */
export function reconcile(db: DbLike, accountId: string, input: unknown, timeZone: string): ReconcileResult {
  const v = reconcileSchema.parse(input);
  return db.transaction((tx) => {
    const appCents = balanceAtEndOfDay(tx, accountId, v.date, timeZone);
    const end = zonedDayStart(addDaysToDate(v.date, 1), timeZone);
    const upTo = and(
      eq(transactions.accountId, accountId),
      eq(transactions.pending, false),
      lt(transactions.posted, end),
    );
    const differenceCents = v.balanceCents - appCents;
    let markedReviewed = 0;
    // Only a reconciled period can be signed off; otherwise the difference needs looking at first.
    if (v.markReviewed) {
      if (differenceCents !== 0)
        throw new ReconcileError(
          "invalid",
          "The balances don't match yet, so these transactions can't be marked reviewed",
        );
      markedReviewed = tx
        .update(transactions)
        .set({ isReviewed: true, updatedAt: sql`(unixepoch())` })
        .where(and(upTo, eq(transactions.isReviewed, false)))
        .returning({ id: transactions.id })
        .all().length;
    }
    const unreviewedCount =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(and(upTo, eq(transactions.isReviewed, false)))
        .get()?.n ?? 0;
    const pendingCount =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.pending, true)))
        .get()?.n ?? 0;
    return {
      date: v.date,
      bankCents: v.balanceCents,
      appCents,
      differenceCents,
      matches: differenceCents === 0,
      unreviewedCount,
      markedReviewed,
      pendingCount,
    };
  });
}
