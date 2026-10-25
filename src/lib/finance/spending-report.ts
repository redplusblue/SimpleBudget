import { format } from "date-fns";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, categories, tags, transactionTags, transactions } from "@/db/schema";
import {
  addDaysToDate,
  daysInMonth,
  isDateString,
  localDateString,
  monthRange,
  shiftMonth,
  zonedDayStart,
} from "./dates";
import { normalizePayee } from "./payee";
import { effectiveDateSql, expenseCondition, incomeCondition } from "./sql";
import type {
  AccountBreakdownRow,
  CategoryBreakdownRow,
  CategoryComparison,
  DailySpend,
  MerchantRow,
  ReportRange,
  SpendingReport,
  TagBreakdownRow,
  TrendReport,
  WeekdayRow,
} from "./spending-report-types";
import { getTransactionRows } from "./transactions-query";

export class ReportError extends Error {}

export const MAX_CUSTOM_DAYS = 366;
export const TOP_MERCHANTS = 15;
export const TREND_MONTHS = 12;
export const CATEGORY_TREND_MONTHS = 6;
export const TOP_TREND_CATEGORIES = 5;

const UNCATEGORIZED_COLOR = "#6B7385";
const OTHER_COLOR = "#6B7385";

export type RangeInput = { month: string } | { from: string; to: string };

interface Bounds extends ReportRange {
  start: number;
  /** Exclusive. */
  end: number;
  prevStart: number;
  prevEnd: number;
}

const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const inclusiveDays = (from: string, to: string) => utcDay(to) - utcDay(from) + 1;
const localDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const monthLabel = (month: string) => format(localDate(`${month}-01`), "MMMM yyyy");
const dayLabel = (date: string) => format(localDate(date), "MMM d, yyyy");

/** Validates a month or custom range and works out its bounds, today's progress and the comparison period. */
export function resolveRange(input: RangeInput, now: number, timeZone: string): Bounds {
  const today = localDateString(now, timeZone);

  if ("month" in input) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new ReportError("month must look like 2026-10");
    const month = input.month;
    const days = daysInMonth(month);
    const { start, end } = monthRange(month, timeZone);
    const prevMonth = shiftMonth(month, -1);
    const prev = monthRange(prevMonth, timeZone);
    const isCurrent = today.slice(0, 7) === month;
    const elapsedDays = isCurrent ? Number(today.slice(8, 10)) : today < `${month}-01` ? 0 : days;
    return {
      kind: "month",
      month,
      from: `${month}-01`,
      to: `${month}-${String(days).padStart(2, "0")}`,
      days,
      elapsedDays,
      label: monthLabel(month),
      isCurrent,
      start,
      end,
      prevStart: prev.start,
      prevEnd: prev.end,
      previous: {
        from: `${prevMonth}-01`,
        to: `${prevMonth}-${String(daysInMonth(prevMonth)).padStart(2, "0")}`,
        label: monthLabel(prevMonth),
      },
    };
  }

  const { from, to } = input;
  if (!isDateString(from) || !isDateString(to)) throw new ReportError("Dates must look like 2026-10-24");
  if (from > to) throw new ReportError("The start date must be on or before the end date");
  const days = inclusiveDays(from, to);
  if (days > MAX_CUSTOM_DAYS) throw new ReportError(`Choose a range of at most ${MAX_CUSTOM_DAYS} days`);
  const prevTo = addDaysToDate(from, -1);
  const prevFrom = addDaysToDate(prevTo, -(days - 1));
  const elapsedDays = today < from ? 0 : Math.min(days, inclusiveDays(from, today < to ? today : to));
  return {
    kind: "custom",
    from,
    to,
    days,
    elapsedDays,
    label: from === to ? dayLabel(from) : `${format(localDate(from), "MMM d")} – ${dayLabel(to)}`,
    isCurrent: today >= from && today <= to,
    start: zonedDayStart(from, timeZone),
    end: zonedDayStart(addDaysToDate(to, 1), timeZone),
    prevStart: zonedDayStart(prevFrom, timeZone),
    prevEnd: zonedDayStart(from, timeZone),
    previous: { from: prevFrom, to: prevTo, label: `${format(localDate(prevFrom), "MMM d")} – ${dayLabel(prevTo)}` },
  };
}

const sumValues = (m: Map<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);

interface Tally {
  cents: number;
  count: number;
}
const bump = <K>(m: Map<K, Tally>, k: K, cents: number) => {
  const t = m.get(k) ?? { cents: 0, count: 0 };
  t.cents += cents;
  t.count++;
  m.set(k, t);
};

const monthsEndingAt = (last: string, n: number) => Array.from({ length: n }, (_, i) => shiftMonth(last, i - (n - 1)));

/** The whole spending-analytics payload for one month or custom range. */
export function getSpendingReport(db: DbLike, input: RangeInput, now: number, timeZone: string): SpendingReport {
  const range = resolveRange(input, now, timeZone);
  const today = localDateString(now, timeZone);
  const lastMonth = range.to.slice(0, 7);
  const trendMonths = monthsEndingAt(lastMonth, TREND_MONTHS);
  const avgMonths = range.kind === "month" ? [1, 2, 3].map((n) => shiftMonth(range.month!, -n)) : [];

  // One pass over every expense that matters: the range, its comparison period, the trend window and the 3 months before.
  const windowStart = Math.min(
    range.start,
    range.prevStart,
    monthRange(trendMonths[0], timeZone).start,
    ...(avgMonths.length ? [monthRange(avgMonths[2], timeZone).start] : []),
  );
  // The trend chart shows whole months, so a custom range ending mid-month still loads the rest of that month.
  const windowEnd = Math.max(range.end, monthRange(lastMonth, timeZone).end);
  const inWindow = and(sql`${effectiveDateSql} >= ${windowStart}`, sql`${effectiveDateSql} < ${windowEnd}`);
  const rows = db
    .select({
      id: transactions.id,
      at: effectiveDateSql,
      cents: transactions.amountCents,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      merchant: transactions.merchantKey,
    })
    .from(transactions)
    .where(and(expenseCondition, inWindow))
    .all();

  const cur = {
    spent: 0,
    count: 0,
    cat: new Map<number | null, Tally>(),
    acct: new Map<string, Tally>(),
    merchant: new Map<string, Tally>(),
    day: new Map<string, number>(),
  };
  let prevSpent = 0;
  const prevCat = new Map<number | null, number>();
  const monthCat = new Map<string, Map<number | null, number>>();
  let largest: { id: number; cents: number } | null = null;

  for (const r of rows) {
    const spend = -r.cents;
    const date = localDateString(r.at, timeZone);
    const month = date.slice(0, 7);
    add(monthCat.get(month) ?? monthCat.set(month, new Map()).get(month)!, r.categoryId, spend);

    if (r.at >= range.start && r.at < range.end) {
      cur.spent += spend;
      cur.count++;
      bump(cur.cat, r.categoryId, spend);
      bump(cur.acct, r.accountId, spend);
      bump(cur.merchant, r.merchant ?? "unknown", spend);
      add(cur.day, date, spend);
      if (!largest || spend > largest.cents) largest = { id: r.id, cents: spend };
    } else if (r.at >= range.prevStart && r.at < range.prevEnd) {
      prevSpent += spend;
      add(prevCat, r.categoryId, spend);
    }
  }

  // Income (money in that isn't a transfer or excluded) for the range, the comparison period and the trend chart.
  const incomeRows = db
    .select({ at: effectiveDateSql, cents: transactions.amountCents })
    .from(transactions)
    .where(and(incomeCondition, inWindow))
    .all();
  let income = 0;
  let prevIncome = 0;
  const incomeByMonth = new Map<string, number>();
  for (const r of incomeRows) {
    add(incomeByMonth, localDateString(r.at, timeZone).slice(0, 7), r.cents);
    if (r.at >= range.start && r.at < range.end) income += r.cents;
    else if (r.at >= range.prevStart && r.at < range.prevEnd) prevIncome += r.cents;
  }

  const catMeta = new Map(
    db
      .select({ id: categories.id, name: categories.name, color: categories.color })
      .from(categories)
      .all()
      .map((c) => [c.id as number | null, c]),
  );
  const meta = (id: number | null) =>
    id === null
      ? { name: "Uncategorized", color: UNCATEGORIZED_COLOR }
      : (catMeta.get(id) ?? { name: "Deleted category", color: UNCATEGORIZED_COLOR });

  // ── summary ───────────────────────────────────────────────────────────────
  let largestInfo: SpendingReport["summary"]["largest"] = null;
  if (largest) {
    const row = getTransactionRows(db, [largest.id])[0];
    if (row)
      largestInfo = {
        id: row.id,
        name: row.displayPayee,
        amountCents: -row.amountCents,
        date: localDateString(row.effectiveDate, timeZone),
      };
  }
  const summary = {
    spentCents: cur.spent,
    incomeCents: income,
    netCents: income - cur.spent,
    savingsRate: income > 0 ? (income - cur.spent) / income : null,
    purchaseCount: cur.count,
    avgPerDayCents: range.elapsedDays > 0 ? Math.round(cur.spent / range.elapsedDays) : 0,
    largest: largestInfo,
    previousSpentCents: prevSpent,
    previousIncomeCents: prevIncome,
  };

  // ── categories: comparison table and breakdown ────────────────────────────
  const ids = new Set<number | null>([...cur.cat.keys(), ...prevCat.keys()]);
  const avgOf = (id: number | null) =>
    avgMonths.length
      ? Math.round(avgMonths.reduce((s, m) => s + (monthCat.get(m)?.get(id) ?? 0), 0) / avgMonths.length)
      : null;
  if (avgMonths.length) for (const m of avgMonths) for (const id of monthCat.get(m)?.keys() ?? []) ids.add(id);
  const comparison: CategoryComparison[] = [...ids]
    .map((id) => {
      const cents = cur.cat.get(id)?.cents ?? 0;
      const previousCents = prevCat.get(id) ?? 0;
      const averageCents = avgOf(id);
      return {
        id,
        ...meta(id),
        cents,
        previousCents,
        averageCents,
        deltaPreviousCents: cents - previousCents,
        deltaAverageCents: averageCents === null ? null : cents - averageCents,
      };
    })
    .filter((c) => c.cents !== 0 || c.previousCents !== 0 || (c.averageCents ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.deltaPreviousCents) - Math.abs(a.deltaPreviousCents) || b.cents - a.cents);

  const trendWindow = monthsEndingAt(lastMonth, CATEGORY_TREND_MONTHS);
  const categoryRows: CategoryBreakdownRow[] = [...cur.cat.entries()]
    .map(([id, t]) => ({
      id,
      ...meta(id),
      cents: t.cents,
      share: cur.spent ? t.cents / cur.spent : 0,
      count: t.count,
      trend: trendWindow.map((m) => monthCat.get(m)?.get(id) ?? 0),
    }))
    .sort((a, b) => b.cents - a.cents);

  // ── tags (a transaction can carry several, so totals may overlap) ─────────
  const tagRows: TagBreakdownRow[] = db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      cents: sql<number>`-sum(${transactions.amountCents})`,
      count: sql<number>`count(*)`,
    })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
    .where(and(expenseCondition, sql`${effectiveDateSql} >= ${range.start}`, sql`${effectiveDateSql} < ${range.end}`))
    .groupBy(tags.id)
    .all()
    .sort((a, b) => b.cents - a.cents);

  // ── merchants ─────────────────────────────────────────────────────────────
  const merchants: MerchantRow[] = [...cur.merchant.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .slice(0, TOP_MERCHANTS)
    .map(([key, t]) => ({
      key,
      name: merchantName(db, key),
      cents: t.cents,
      count: t.count,
      avgCents: Math.round(t.cents / t.count),
    }));

  // ── accounts ──────────────────────────────────────────────────────────────
  const acctIds = [...cur.acct.keys()];
  const acctMeta = new Map(
    (acctIds.length
      ? db
          .select({ id: accounts.id, name: accounts.name, displayName: accounts.displayName, color: accounts.color })
          .from(accounts)
          .where(inArray(accounts.id, acctIds))
          .all()
      : []
    ).map((a) => [a.id, a]),
  );
  const accountRows: AccountBreakdownRow[] = [...cur.acct.entries()]
    .map(([id, t]) => ({
      id,
      name: acctMeta.get(id)?.displayName?.trim() || acctMeta.get(id)?.name || id,
      color: acctMeta.get(id)?.color ?? null,
      cents: t.cents,
      share: cur.spent ? t.cents / cur.spent : 0,
      count: t.count,
    }))
    .sort((a, b) => b.cents - a.cents);

  // ── daily heatmap and weekday pattern ─────────────────────────────────────
  const daily: DailySpend[] = [];
  const weekdayTotals = new Array<number>(7).fill(0);
  const weekdayDays = new Array<number>(7).fill(0);
  for (let d = range.from; d <= range.to; d = addDaysToDate(d, 1)) {
    const cents = cur.day.get(d) ?? 0;
    const future = d > today;
    daily.push({ date: d, cents, future });
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    weekdayTotals[dow] += cents;
    if (!future) weekdayDays[dow]++;
  }
  const weekdays: WeekdayRow[] = weekdayTotals.map((cents, dow) => ({
    dow,
    cents,
    occurrences: weekdayDays[dow],
    avgCents: weekdayDays[dow] ? Math.round(cents / weekdayDays[dow]) : 0,
  }));

  // ── 12 month trend: top categories stacked, plus income ───────────────────
  const totals = new Map<number | null, number>();
  for (const m of trendMonths) for (const [id, v] of monthCat.get(m) ?? []) add(totals, id, v);
  const topIds = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TREND_CATEGORIES)
    .map(([id]) => id);
  const series = topIds.map((id) => ({
    id,
    ...meta(id),
    values: trendMonths.map((m) => monthCat.get(m)?.get(id) ?? 0),
  }));
  const otherValues = trendMonths.map(
    (m) => sumValues(monthCat.get(m) ?? new Map()) - series.reduce((s, x) => s + x.values[trendMonths.indexOf(m)], 0),
  );
  if (otherValues.some((v) => v > 0))
    series.push({ id: null, name: "Everything else", color: OTHER_COLOR, values: otherValues });
  const trends: TrendReport = {
    months: trendMonths,
    series,
    incomeCents: trendMonths.map((m) => incomeByMonth.get(m) ?? 0),
  };

  const { start: _s, end: _e, prevStart: _ps, prevEnd: _pe, ...publicRange } = range;
  void [_s, _e, _ps, _pe];
  return {
    range: publicRange,
    summary,
    comparison,
    categories: categoryRows,
    tags: tagRows,
    merchants,
    accounts: accountRows,
    daily,
    weekdays,
    trends,
  };
}

/** A readable name for a merchant key: the cleaned-up name on its most recent transaction. */
export function merchantName(db: DbLike, key: string): string {
  const row = db
    .select({
      payeeOverride: transactions.payeeOverride,
      payee: transactions.payee,
      description: transactions.description,
    })
    .from(transactions)
    .where(eq(transactions.merchantKey, key))
    .orderBy(sql`${transactions.posted} desc`, sql`${transactions.id} desc`)
    .limit(1)
    .get();
  return row ? normalizePayee(row.payeeOverride?.trim() || row.payee?.trim() || row.description) || key : key;
}
