import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { categories, transactions } from "@/db/schema";
import { daysInMonth, localDateString, monthRange, shiftMonth } from "./dates";
import type { CategoryBreakdown, CategorySlice, MonthGlance, SpendingChart, SpendingPoint } from "./dashboard-types";
import { effectiveDateSql, expenseCondition, incomeCondition } from "./sql";

const UNCATEGORIZED_COLOR = "#6B7385";
export const TOP_CATEGORIES = 6;

/** Spending (positive cents) per local `YYYY-MM-DD`, for expenses dated in `[start, end)`. */
export function dailySpending(db: DbLike, start: number, end: number, timeZone: string): Map<string, number> {
  const rows = db
    .select({ at: effectiveDateSql, cents: transactions.amountCents })
    .from(transactions)
    .where(and(expenseCondition, sql`${effectiveDateSql} >= ${start}`, sql`${effectiveDateSql} < ${end}`))
    .all();
  const days = new Map<string, number>();
  for (const r of rows) {
    const key = localDateString(r.at, timeZone);
    days.set(key, (days.get(key) ?? 0) - r.cents);
  }
  return days;
}

/** Cumulative spending by day-of-month (index 0 = day 1) for one month. */
export function cumulativeForMonth(days: Map<string, number>, month: string): number[] {
  const out: number[] = [];
  let running = 0;
  for (let d = 1; d <= daysInMonth(month); d++) {
    running += days.get(`${month}-${String(d).padStart(2, "0")}`) ?? 0;
    out.push(running);
  }
  return out;
}

export function monthIncomeCents(db: DbLike, month: string, timeZone: string): number {
  const { start, end } = monthRange(month, timeZone);
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(transactions)
      .where(and(incomeCondition, sql`${effectiveDateSql} >= ${start}`, sql`${effectiveDateSql} < ${end}`))
      .get()?.total ?? 0
  );
}

export interface MonthlySpending {
  glance: MonthGlance;
  chart: SpendingChart;
}

/** The "this month" numbers and the cumulative spending chart (this month vs last vs 3-month average). */
export function getMonthlySpending(db: DbLike, month: string, now: number, timeZone: string): MonthlySpending {
  const today = localDateString(now, timeZone);
  const currentMonth = today.slice(0, 7);
  const isCurrent = month === currentMonth;
  const lastMonth = shiftMonth(month, -1);
  const history = [shiftMonth(month, -1), shiftMonth(month, -2), shiftMonth(month, -3)];

  const days = dailySpending(db, monthRange(history[2], timeZone).start, monthRange(month, timeZone).end, timeZone);
  const cur = cumulativeForMonth(days, month);
  const last = cumulativeForMonth(days, lastMonth);
  const hist = history.map((m) => cumulativeForMonth(days, m));
  const historyHasData = hist.some((h) => h[h.length - 1] > 0);

  const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : cur.length;
  const spentCents = isCurrent ? cur[dayOfMonth - 1] : cur[cur.length - 1];
  const incomeCents = monthIncomeCents(db, month, timeZone);

  const points: SpendingPoint[] = cur.map((value, i) => {
    const day = i + 1;
    // Months shorter than this one stay at their total after their last day.
    const avgs = hist.map((h) => h[Math.min(i, h.length - 1)]);
    return {
      day,
      current: day <= dayOfMonth ? value : null,
      last: i < last.length ? last[i] : null,
      average: historyHasData ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
    };
  });

  const lastToDate = last[Math.min(dayOfMonth, last.length) - 1] ?? 0;
  return {
    glance: {
      month,
      isCurrent,
      spentCents,
      incomeCents,
      netCents: incomeCents - spentCents,
      pace: isCurrent ? { dayOfMonth, lastMonthToDateCents: lastToDate, deltaCents: spentCents - lastToDate } : null,
    },
    chart: { month, lastMonth, points, hasComparison: last[last.length - 1] > 0 || historyHasData },
  };
}

interface CategoryTotal {
  id: number | null;
  name: string | null;
  color: string | null;
  cents: number;
}

function categoryTotals(db: DbLike, month: string, timeZone: string): CategoryTotal[] {
  const { start, end } = monthRange(month, timeZone);
  return db
    .select({
      id: transactions.categoryId,
      name: categories.name,
      color: categories.color,
      cents: sql<number>`-sum(${transactions.amountCents})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(expenseCondition, gte(effectiveDateSql, start), lt(effectiveDateSql, end)))
    .groupBy(transactions.categoryId)
    .all();
}

/** Spending by category for a month, largest first, with change vs the previous month. */
export function getCategoryBreakdown(
  db: DbLike,
  month: string,
  timeZone: string,
  top = TOP_CATEGORIES,
): CategoryBreakdown {
  const current = categoryTotals(db, month, timeZone);
  const previous = new Map(categoryTotals(db, shiftMonth(month, -1), timeZone).map((c) => [c.id, c.cents]));
  const totalCents = current.reduce((s, c) => s + c.cents, 0);

  const sorted = [...current].sort((a, b) => b.cents - a.cents);
  const items: CategorySlice[] = sorted.slice(0, top).map((c) => ({
    id: c.id,
    name: c.name ?? "Uncategorized",
    color: c.color ?? UNCATEGORIZED_COLOR,
    cents: c.cents,
    share: totalCents ? c.cents / totalCents : 0,
    previousCents: previous.get(c.id) ?? 0,
    deltaCents: c.cents - (previous.get(c.id) ?? 0),
  }));
  const otherCents = sorted.slice(top).reduce((s, c) => s + c.cents, 0);
  return { totalCents, items, otherCents };
}
