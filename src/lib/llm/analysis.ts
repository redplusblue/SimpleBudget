import type { DbLike } from "@/db/open";
import { formatCents } from "@/lib/finance/cents";
import { localDateString } from "@/lib/finance/dates";
import { normalizePayee } from "@/lib/finance/payee";
import { detectRecurring } from "@/lib/finance/recurring";
import { getSpendingReport, type RangeInput } from "@/lib/finance/spending-report";
import { MAX_PAGE_SIZE, queryTransactions } from "@/lib/finance/transactions-query";
import { getYearInReview } from "@/lib/finance/year";

// Compact, already-formatted answers to the questions people actually ask about their money. The AI tools, the
// local MCP server and `pnpm ai:export` all read through here so they agree, and none of them can see account
// ids, notes, memos or raw bank descriptions.

const $ = (cents: number) => formatCents(cents);

interface Env {
  now: number;
  timeZone: string;
}

/** Everything about one stretch of time (a month, or a custom range of up to a year). */
export function periodReport(db: DbLike, input: RangeInput, env: Env) {
  const r = getSpendingReport(db, input, env.now, env.timeZone);
  return {
    period: { from: r.range.from, to: r.range.to, days: r.range.days, comparedWith: r.range.previous.label },
    spent: $(r.summary.spentCents),
    income: $(r.summary.incomeCents),
    net: $(r.summary.netCents),
    savingsRate: r.summary.savingsRate === null ? null : `${Math.round(r.summary.savingsRate * 100)}%`,
    purchases: r.summary.purchaseCount,
    averagePerDay: $(r.summary.avgPerDayCents),
    previousPeriod: { spent: $(r.summary.previousSpentCents), income: $(r.summary.previousIncomeCents) },
    largestPurchase: r.summary.largest
      ? { payee: r.summary.largest.name, amount: $(r.summary.largest.amountCents), date: r.summary.largest.date }
      : null,
    categories: r.comparison.slice(0, 20).map((c) => ({
      name: c.name,
      spent: $(c.cents),
      previous: $(c.previousCents),
      change: $(c.deltaPreviousCents),
    })),
    topMerchants: r.merchants.slice(0, 10).map((m) => ({
      name: m.name,
      total: $(m.cents),
      purchases: m.count,
      average: $(m.avgCents),
    })),
    byWeekday: r.weekdays.map((w) => ({
      day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w.dow],
      averageSpend: $(w.avgCents),
    })),
  };
}

/** Month-by-month spending and income for the 12 months ending at `endMonth`, with the biggest categories. */
export function monthlyTrend(db: DbLike, endMonth: string, env: Env) {
  const { trends } = getSpendingReport(db, { month: endMonth }, env.now, env.timeZone);
  return {
    months: trends.months.map((month, i) => {
      const spent = trends.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
      const income = trends.incomeCents[i] ?? 0;
      return { month, spent: $(spent), income: $(income), net: $(income - spent) };
    }),
    categories: trends.series.map((s) => ({
      name: s.name,
      byMonth: Object.fromEntries(trends.months.map((m, i) => [m, $(s.values[i] ?? 0)])),
    })),
  };
}

/** Detected subscriptions and regular bills, including price increases and ones that look cancelled. */
export function recurringSummary(db: DbLike, env: Env) {
  const r = detectRecurring(db, env.now, env.timeZone);
  const item = (i: (typeof r.items)[number]) => ({
    name: i.name,
    cadence: i.cadence,
    amount: $(i.amountCents),
    perMonth: $(i.monthlyCostCents),
    nextDate: i.nextDate,
    lastDate: i.lastDate,
    priceIncrease:
      i.increasePct === null ? null : `+${Math.round(i.increasePct * 100)}% (was ${$(i.previousAmountCents ?? 0)})`,
  });
  return {
    perMonth: $(r.monthlyTotalCents),
    perYear: $(r.yearlyTotalCents),
    active: r.items.map(item),
    probablyCancelled: r.inactive.map(item),
  };
}

/** One calendar year in review. */
export function yearSummary(db: DbLike, year: number, env: Env) {
  const y = getYearInReview(db, year, env.now, env.timeZone);
  return {
    year: y.year,
    partial: y.partial,
    spent: $(y.spentCents),
    income: $(y.incomeCents),
    savingsRate: y.savingsRate === null ? null : `${Math.round(y.savingsRate * 100)}%`,
    previousYear: { spent: $(y.previousSpentCents), income: $(y.previousIncomeCents) },
    noSpendDays: y.noSpendDays,
    byMonth: y.months.map((m) => ({ month: m.month, spent: $(m.spentCents), income: $(m.incomeCents) })),
    topCategories: y.topCategories.map((c) => ({
      name: c.name,
      spent: $(c.cents),
      share: `${Math.round(c.share * 100)}%`,
    })),
    topMerchants: y.topMerchants.map((c) => ({ name: c.name, spent: $(c.cents), purchases: c.count })),
    risers: y.risers.map((m) => ({ name: m.name, spent: $(m.cents), change: $(m.deltaCents) })),
    fallers: y.fallers.map((m) => ({ name: m.name, spent: $(m.cents), change: $(m.deltaCents) })),
    biggestPurchase: y.biggestPurchase
      ? { payee: y.biggestPurchase.name, amount: $(y.biggestPurchase.amountCents), date: y.biggestPurchase.date }
      : null,
    recurring: { count: y.recurringCount, perYear: $(y.recurringYearlyCents) },
  };
}

/** What one merchant (matched by text in the payee) has cost, month by month. */
export function merchantHistory(db: DbLike, query: string, env: Env) {
  const page = queryTransactions(
    db,
    { q: query },
    { limit: MAX_PAGE_SIZE, timeZone: env.timeZone, includeTotal: true },
  );
  const byMonth = new Map<string, { cents: number; count: number }>();
  const payees = new Set<string>();
  let total = 0;
  for (const r of page.rows) {
    payees.add(normalizePayee(r.displayPayee) || "Unknown");
    const month = localDateString(r.effectiveDate, env.timeZone).slice(0, 7);
    const m = byMonth.get(month) ?? { cents: 0, count: 0 };
    m.cents += r.amountCents;
    m.count++;
    byMonth.set(month, m);
    total += r.amountCents;
  }
  return {
    query,
    matchingTransactions: page.total ?? page.rows.length,
    // Only the newest MAX_PAGE_SIZE rows are summed; say so rather than silently under-counting.
    coveredTransactions: page.rows.length,
    matchedPayees: [...payees].slice(0, 10),
    netAmount: $(total),
    byMonth: [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([month, m]) => ({ month, net: $(m.cents), transactions: m.count })),
  };
}
