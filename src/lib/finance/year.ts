import { and, eq } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, transactions } from "@/db/schema";
import { localDateString } from "./dates";
import { netWorthBetween } from "./networth";
import { detectRecurring } from "./recurring";
import { effectiveDateSql } from "./sql";
import { getSpendingReport } from "./spending-report";
import type { YearInReview, YearMonth, YearMover } from "./year-types";

export class YearError extends Error {}

const MOVERS = 3;
const TOP = 8;

/** Years (newest first) that have at least one transaction, always including the current one. */
export function availableYears(db: DbLike, now: number, timeZone: string): number[] {
  const current = Number(localDateString(now, timeZone).slice(0, 4));
  const first = db.select({ at: effectiveDateSql }).from(transactions).orderBy(effectiveDateSql).limit(1).get();
  const start = first ? Number(localDateString(first.at, timeZone).slice(0, 4)) : current;
  return Array.from({ length: current - Math.min(start, current) + 1 }, (_, i) => current - i);
}

/** A look back at one calendar year: totals, the pattern by month, where the money went and what changed. */
export function getYearInReview(db: DbLike, year: number, now: number, timeZone: string): YearInReview {
  const today = localDateString(now, timeZone);
  const currentYear = Number(today.slice(0, 4));
  if (!Number.isInteger(year) || year < 1970 || year > currentYear)
    throw new YearError("Choose a year that has happened");

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const report = getSpendingReport(db, { from, to }, now, timeZone);
  const s = report.summary;
  const partial = year === currentYear && today < to;
  const lastDay = partial ? today : to;

  const months: YearMonth[] = report.trends.months.map((month, i) => ({
    month,
    incomeCents: report.trends.incomeCents[i],
    spentCents: report.trends.series.reduce((sum, ser) => sum + (ser.values[i] ?? 0), 0),
  }));
  const counted = months.filter((m) => m.month <= lastDay.slice(0, 7) && (m.spentCents > 0 || m.incomeCents > 0));
  const priciest = counted.length ? counted.reduce((a, b) => (b.spentCents > a.spentCents ? b : a)) : null;
  const cheapest = counted.length > 1 ? counted.reduce((a, b) => (b.spentCents < a.spentCents ? b : a)) : null;

  const daily = report.daily.filter((d) => !d.future);
  const busiest = daily.length ? daily.reduce((a, b) => (b.cents > a.cents ? b : a)) : null;
  const movers = (sign: 1 | -1): YearMover[] =>
    report.comparison
      .filter((c) => (sign === 1 ? c.deltaPreviousCents > 0 : c.deltaPreviousCents < 0))
      .sort((a, b) => sign * (b.deltaPreviousCents - a.deltaPreviousCents))
      .slice(0, MOVERS)
      .map((c) => ({ name: c.name, cents: c.cents, previousCents: c.previousCents, deltaCents: c.deltaPreviousCents }));

  // Net worth across the year, from the daily balance history of the accounts that count.
  const ids = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.excludeFromNetWorth, false), eq(accounts.isHidden, false)))
    .all()
    .map((a) => a.id);
  const series = netWorthBetween(db, ids, from, lastDay);
  const netWorth =
    series.length >= 2
      ? {
          startCents: series[0].balanceCents,
          endCents: series[series.length - 1].balanceCents,
          changeCents: series[series.length - 1].balanceCents - series[0].balanceCents,
        }
      : null;

  const recurring = detectRecurring(db, now, timeZone);
  const daysSoFar = report.range.elapsedDays;
  const spendDays = new Set(daily.filter((d) => d.cents > 0).map((d) => d.date)).size;

  return {
    year,
    partial,
    availableYears: availableYears(db, now, timeZone),
    spentCents: s.spentCents,
    incomeCents: s.incomeCents,
    savingsRate: s.savingsRate,
    previousSpentCents: s.previousSpentCents,
    previousIncomeCents: s.previousIncomeCents,
    purchaseCount: s.purchaseCount,
    avgPerDayCents: s.avgPerDayCents,
    noSpendDays: Math.max(0, daysSoFar - spendDays),
    daysCounted: daysSoFar,
    months,
    priciestMonth: priciest,
    cheapestMonth: cheapest && cheapest.month !== priciest?.month ? cheapest : null,
    topCategories: report.categories
      .slice(0, TOP)
      .map((c) => ({ id: c.id, name: c.name, cents: c.cents, share: c.share, count: c.count })),
    topMerchants: report.merchants.slice(0, TOP).map((m) => ({
      id: null,
      name: m.name,
      cents: m.cents,
      share: s.spentCents ? m.cents / s.spentCents : 0,
      count: m.count,
    })),
    risers: movers(1),
    fallers: movers(-1),
    biggestPurchase: s.largest
      ? { name: s.largest.name, amountCents: s.largest.amountCents, date: s.largest.date }
      : null,
    busiestDay: busiest && busiest.cents > 0 ? { date: busiest.date, cents: busiest.cents } : null,
    netWorth,
    recurringYearlyCents: recurring.yearlyTotalCents,
    recurringCount: recurring.items.length,
  };
}
