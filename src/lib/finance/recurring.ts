import { and, eq, gte, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { transactions } from "@/db/schema";
import { addDaysToDate, daysInMonth, localDateString, shiftMonth } from "./dates";
import type { Cadence, RecurringItem, RecurringReport } from "./recurring-types";
import { merchantName } from "./spending-report";
import { effectiveDateSql, expenseCondition } from "./sql";

export const MIN_OCCURRENCES = 3;
/** Intervals may deviate this much from the cadence (±20%). */
export const INTERVAL_TOLERANCE = 0.2;
/** Charges may deviate this much from their typical amount (±10%). */
export const AMOUNT_TOLERANCE = 0.1;
/** A share of intervals that must fit the cadence; one skipped month in a year is allowed. */
export const MIN_FIT = 0.75;
/** A new price counts as an increase from this much up. */
export const INCREASE_THRESHOLD = 0.02;
/** Three yearly charges need ~2 years of history; look back a little further than that. */
export const LOOKBACK_DAYS = 3 * 366;

const CADENCES: ReadonlyArray<{ cadence: Cadence; days: number }> = [
  { cadence: "weekly", days: 7 },
  { cadence: "biweekly", days: 14 },
  { cadence: "monthly", days: 30 },
  { cadence: "yearly", days: 365 },
];

const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The cadence whose interval most of `intervals` fit, or null. */
export function detectCadence(intervals: number[]): { cadence: Cadence; days: number } | null {
  if (intervals.length < MIN_OCCURRENCES - 1) return null;
  const m = median(intervals);
  const nearest = CADENCES.reduce((best, c) => (Math.abs(m - c.days) < Math.abs(m - best.days) ? c : best));
  if (Math.abs(m - nearest.days) > INTERVAL_TOLERANCE * nearest.days) return null;
  const fit =
    intervals.filter((i) => Math.abs(i - nearest.days) <= INTERVAL_TOLERANCE * nearest.days).length / intervals.length;
  return fit >= MIN_FIT ? nearest : null;
}

/** The date one cadence step after `date`; months and years keep the day of the month where they can. */
export function nextDate(date: string, cadence: Cadence): string {
  if (cadence === "weekly") return addDaysToDate(date, 7);
  if (cadence === "biweekly") return addDaysToDate(date, 14);
  const [y, m, d] = date.split("-").map(Number);
  const target =
    cadence === "monthly"
      ? shiftMonth(`${y}-${String(m).padStart(2, "0")}`, 1)
      : shiftMonth(`${y}-${String(m).padStart(2, "0")}`, 12);
  return `${target}-${String(Math.min(d, daysInMonth(target))).padStart(2, "0")}`;
}

export function monthlyCost(amountCents: number, cadence: Cadence): number {
  switch (cadence) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "monthly":
      return amountCents;
    case "yearly":
      return Math.round(amountCents / 12);
  }
}

interface Charge {
  id: number;
  date: string;
  cents: number;
  accountId: string;
  categoryId: number | null;
}

/**
 * Decides whether one merchant's charges form a recurring series, and what it costs now.
 * Amounts must stay within ±10% of their typical value; the most recent charge may jump further (a price
 * change), in which case it's flagged as an increase.
 */
export function analyzeSeries(key: string, name: string, charges: Charge[], today: string): RecurringItem | null {
  if (charges.length < MIN_OCCURRENCES) return null;
  const sorted = [...charges].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const intervals = sorted.slice(1).map((c, i) => utcDay(c.date) - utcDay(sorted[i].date));
  const cadence = detectCadence(intervals);
  if (!cadence) return null;

  const amounts = sorted.map((c) => c.cents);
  const tight = (xs: number[]) => {
    const m = median(xs);
    return xs.every((x) => Math.abs(x - m) <= AMOUNT_TOLERANCE * m);
  };
  const earlier = amounts.slice(0, -1);
  const last = amounts[amounts.length - 1];
  let previous: number | null = null;
  if (tight(amounts)) {
    previous = earlier.length ? median(earlier) : null;
  } else if (earlier.length >= MIN_OCCURRENCES && tight(earlier)) {
    previous = median(earlier); // steady, then the latest charge jumped
  } else {
    return null;
  }

  const increase = previous !== null && last >= previous * (1 + INCREASE_THRESHOLD) ? last / previous - 1 : null;
  const lastCharge = sorted[sorted.length - 1];
  const next = nextDate(lastCharge.date, cadence.cadence);
  const overdueDays = Math.max(0, utcDay(today) - utcDay(next));
  // Allow a week (or half a cadence) of lateness before assuming it was cancelled.
  const active = overdueDays <= Math.max(7, Math.round(cadence.days / 2));

  return {
    key,
    name,
    cadence: cadence.cadence,
    amountCents: last,
    previousAmountCents: previous !== null && Math.round(previous) !== last ? Math.round(previous) : null,
    increasePct: increase,
    count: sorted.length,
    firstDate: sorted[0].date,
    lastDate: lastCharge.date,
    nextDate: next,
    monthlyCostCents: monthlyCost(last, cadence.cadence),
    active,
    overdueDays,
    accountId: lastCharge.accountId,
    categoryId: lastCharge.categoryId,
  };
}

/** Finds subscriptions and other recurring bills in the posted purchase history. */
export function detectRecurring(db: DbLike, now: number, timeZone: string): RecurringReport {
  const today = localDateString(now, timeZone);
  const since = now - LOOKBACK_DAYS * 86_400;
  const rows = db
    .select({
      id: transactions.id,
      at: effectiveDateSql,
      cents: transactions.amountCents,
      key: transactions.merchantKey,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(
      and(
        expenseCondition,
        eq(transactions.pending, false),
        gte(transactions.posted, since),
        sql`${transactions.merchantKey} IS NOT NULL AND ${transactions.merchantKey} <> 'unknown'`,
      ),
    )
    .all();

  const byKey = new Map<string, Charge[]>();
  for (const r of rows) {
    const list = byKey.get(r.key!) ?? [];
    list.push({
      id: r.id,
      date: localDateString(r.at, timeZone),
      cents: -r.cents,
      accountId: r.accountId,
      categoryId: r.categoryId,
    });
    byKey.set(r.key!, list);
  }

  const items: RecurringItem[] = [];
  for (const [key, charges] of byKey) {
    if (charges.length < MIN_OCCURRENCES) continue; // cheap pre-check before naming anything
    const item = analyzeSeries(key, "", charges, today);
    if (item) items.push({ ...item, name: merchantName(db, key) });
  }

  const active = items
    .filter((i) => i.active)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : b.amountCents - a.amountCents));
  const inactive = items.filter((i) => !i.active).sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  const monthlyTotalCents = active.reduce((s, i) => s + i.monthlyCostCents, 0);
  return { items: active, inactive, monthlyTotalCents, yearlyTotalCents: monthlyTotalCents * 12 };
}

export interface UpcomingCharge extends RecurringItem {
  /** Whole days from today until the expected date (negative when late). */
  inDays: number;
}

/** Active charges expected within `days` days (late ones first), for the dashboard's Upcoming card. */
export function upcomingCharges(report: RecurringReport, today: string, days = 30, limit = 5): UpcomingCharge[] {
  const horizon = addDaysToDate(today, days);
  return report.items
    .filter((i) => i.nextDate <= horizon)
    .map((i) => ({ ...i, inDays: utcDay(i.nextDate) - utcDay(today) }))
    .slice(0, limit);
}
