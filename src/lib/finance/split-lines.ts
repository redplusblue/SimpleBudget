import { and, eq, type SQL } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { transactionSplits, transactions } from "@/db/schema";
import { expenseCondition } from "./sql";

export interface SplitLine {
  transactionId: number;
  categoryId: number | null;
  /** Positive cents spent in this part. */
  cents: number;
}

/**
 * The parts of split expenses matching `window`. Statistics that group by category count these instead of the parent
 * transaction (whose own category is empty), so each part lands in its own category and totals stay the same.
 */
export function splitExpenseLines(db: DbLike, window: SQL | undefined): SplitLine[] {
  return db
    .select({
      transactionId: transactionSplits.transactionId,
      categoryId: transactionSplits.categoryId,
      amountCents: transactionSplits.amountCents,
    })
    .from(transactionSplits)
    .innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId))
    .where(and(expenseCondition, window))
    .all()
    .map((r) => ({ transactionId: r.transactionId, categoryId: r.categoryId, cents: -r.amountCents }));
}

/** Total spent per category across split parts only. */
export function splitSpendByCategory(db: DbLike, window: SQL | undefined): Map<number | null, number> {
  const out = new Map<number | null, number>();
  for (const l of splitExpenseLines(db, window)) out.set(l.categoryId, (out.get(l.categoryId) ?? 0) + l.cents);
  return out;
}
