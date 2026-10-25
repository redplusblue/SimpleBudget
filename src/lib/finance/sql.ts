import { and, eq, sql, type SQL } from "drizzle-orm";
import { transactions } from "@/db/schema";

/**
 * The date a transaction "belongs" to. Pending items have no posted date (it's 0), so they use the
 * purchase date, falling back to when we first saw them.
 */
export const effectiveDateSql = sql<number>`CASE WHEN ${transactions.pending} = 1 THEN COALESCE(${transactions.transactedAt}, ${transactions.importedAt}) ELSE ${transactions.posted} END`;

/**
 * Expense = money out, not a transfer, not excluded from stats, and not filed under an income category.
 * Credit card payments are transfers, so purchases count once, when they happen.
 */
export const expenseCondition: SQL = and(
  sql`${transactions.amountCents} < 0`,
  eq(transactions.isTransfer, false),
  eq(transactions.isExcluded, false),
  sql`coalesce((select is_income from categories cat where cat.id = ${transactions.categoryId}), 0) = 0`,
)!;

/** Income = money in, not a transfer, not excluded from stats. */
export const incomeCondition: SQL = and(
  sql`${transactions.amountCents} > 0`,
  eq(transactions.isTransfer, false),
  eq(transactions.isExcluded, false),
)!;

/** True when the transaction has been split across categories (its own category is then empty). */
export const hasSplitsSql: SQL = sql`EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = ${transactions.id})`;
export const noSplitsSql: SQL = sql`NOT EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = ${transactions.id})`;
