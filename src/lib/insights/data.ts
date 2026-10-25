import { and, eq, gte, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { transactions } from "@/db/schema";
import { localDateString } from "@/lib/finance/dates";
import { effectiveDateSql, expenseCondition, incomeCondition } from "@/lib/finance/sql";

/** How far back the generators look for a baseline. */
export const HISTORY_DAYS = 365;

export interface TxnRow {
  id: number;
  /** Local date, `YYYY-MM-DD`. */
  date: string;
  /** Unix seconds of the effective date. */
  at: number;
  /** Positive cents (spent, or received for income rows). */
  cents: number;
  merchantKey: string | null;
  categoryId: number | null;
  accountId: string;
}

export interface InsightContext {
  db: DbLike;
  now: number;
  timeZone: string;
  /** Local date of `now`. */
  today: string;
  /** The month the insights are about (`YYYY-MM`). */
  month: string;
  /** Expense and income rows of the last year, loaded once and shared between generators. */
  expenses: () => TxnRow[];
  income: () => TxnRow[];
}

function load(db: DbLike, now: number, timeZone: string, kind: "expense" | "income"): TxnRow[] {
  const rows = db
    .select({
      id: transactions.id,
      at: effectiveDateSql,
      cents: transactions.amountCents,
      merchantKey: transactions.merchantKey,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(
      and(
        kind === "expense" ? expenseCondition : incomeCondition,
        gte(transactions.posted, now - HISTORY_DAYS * 86_400),
        // Pending items are still moving, so they would make duplicates and outliers noisy.
        eq(transactions.pending, false),
      ),
    )
    .orderBy(sql`${effectiveDateSql} asc`, transactions.id)
    .all();
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    date: localDateString(r.at, timeZone),
    cents: Math.abs(r.cents),
    merchantKey: r.merchantKey,
    categoryId: r.categoryId,
    accountId: r.accountId,
  }));
}

export function createContext(db: DbLike, now: number, timeZone: string, month: string): InsightContext {
  let expenses: TxnRow[] | undefined;
  let income: TxnRow[] | undefined;
  return {
    db,
    now,
    timeZone,
    today: localDateString(now, timeZone),
    month,
    expenses: () => (expenses ??= load(db, now, timeZone, "expense")),
    income: () => (income ??= load(db, now, timeZone, "income")),
  };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function meanAndStdDev(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length || 1);
  return { mean, sd: Math.sqrt(variance) };
}
