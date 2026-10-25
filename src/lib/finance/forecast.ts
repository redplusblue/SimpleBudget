import { and, eq, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts } from "@/db/schema";
import { createContext } from "@/lib/insights/data";
import { addDaysToDate, localDateString } from "./dates";
import type { Forecast, ForecastEvent } from "./forecast-types";
import { analyzeSeries, detectRecurring, nextDate } from "./recurring";
import type { Cadence } from "./recurring-types";
import { merchantName } from "./spending-report";

export const FORECAST_DAYS = 30;
const SPENDING_WINDOW_DAYS = 90;
/** Deposits below this aren't treated as income worth projecting (refunds, small transfers). */
const MIN_INCOME_CENTS = 100_00;

/** The dates a series lands on within (today, horizon], stepping by its cadence; an overdue one is expected tomorrow. */
function occurrences(first: string, cadence: Cadence, today: string, horizon: string): string[] {
  const out: string[] = [];
  let d = first <= today ? addDaysToDate(today, 1) : first;
  for (let guard = 0; d <= horizon && guard < 100; guard++) {
    out.push(d);
    d = nextDate(d, cadence);
  }
  return out;
}

/**
 * A 30-day projection of your cash (checking, savings and cash accounts) from the bills and income that repeat on a
 * schedule. Charges on credit cards are counted on the day they're expected, as if paid at once. A second line also
 * subtracts the typical day-to-day spending.
 */
export function getForecast(db: DbLike, now: number, timeZone: string, horizonDays = FORECAST_DAYS): Forecast {
  const today = localDateString(now, timeZone);
  const horizon = addDaysToDate(today, horizonDays);

  const cash = db
    .select({ id: accounts.id, balance: accounts.balanceCents })
    .from(accounts)
    .where(
      and(
        sql`${accounts.type} IN ('checking','savings','cash')`,
        eq(accounts.isHidden, false),
        eq(accounts.isClosed, false),
      ),
    )
    .all();
  const cashIds = new Set(cash.map((a) => a.id));
  const startCents = cash.reduce((s, a) => s + a.balance, 0);

  const events: ForecastEvent[] = [];
  const recurring = detectRecurring(db, now, timeZone);
  for (const item of recurring.items) {
    for (const date of occurrences(item.nextDate, item.cadence, today, horizon))
      events.push({ date, name: item.name, amountCents: -item.amountCents, kind: "bill" });
  }

  // Regular deposits (paychecks, rent received) into the cash accounts, found the same way as subscriptions.
  const byMerchant = new Map<
    string,
    Array<{ id: number; date: string; cents: number; accountId: string; categoryId: number | null }>
  >();
  for (const r of createContext(db, now, timeZone, today.slice(0, 7)).income()) {
    if (!r.merchantKey || r.merchantKey === "unknown" || r.cents < MIN_INCOME_CENTS || !cashIds.has(r.accountId))
      continue;
    const list = byMerchant.get(r.merchantKey);
    const charge = { id: r.id, date: r.date, cents: r.cents, accountId: r.accountId, categoryId: r.categoryId };
    if (list) list.push(charge);
    else byMerchant.set(r.merchantKey, [charge]);
  }
  for (const [key, charges] of byMerchant) {
    const item = analyzeSeries(key, "", charges, today);
    if (!item || !item.active) continue;
    const name = merchantName(db, key);
    for (const date of occurrences(item.nextDate, item.cadence, today, horizon))
      events.push({ date, name, amountCents: item.amountCents, kind: "income" });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amountCents - b.amountCents));

  // Typical everyday spending: what left the cash accounts over 90 days, minus the recurring bills, per day.
  const since = now - SPENDING_WINDOW_DAYS * 86_400;
  const spent = createContext(db, now, timeZone, today.slice(0, 7))
    .expenses()
    .filter((r) => r.at >= since)
    .reduce((s, r) => s + r.cents, 0);
  const recurringInWindow = Math.round((recurring.monthlyTotalCents * SPENDING_WINDOW_DAYS) / 30.4375);
  const typicalDailySpendCents = Math.max(0, Math.round((spent - recurringInWindow) / SPENDING_WINDOW_DAYS));

  const days: Forecast["days"] = [];
  let balance = startCents;
  let withSpending = startCents;
  for (let i = 0; i <= horizonDays; i++) {
    const date = addDaysToDate(today, i);
    for (const e of events) {
      if (e.date !== date) continue;
      balance += e.amountCents;
      withSpending += e.amountCents;
    }
    if (i > 0) withSpending -= typicalDailySpendCents;
    days.push({ date, balanceCents: balance, withSpendingCents: withSpending });
  }

  const lowestOf = (pick: (d: Forecast["days"][number]) => number) =>
    days.reduce((lo, d) => (pick(d) < lo.balanceCents ? { date: d.date, balanceCents: pick(d) } : lo), {
      date: days[0].date,
      balanceCents: pick(days[0]),
    });
  const firstBelowZero = (pick: (d: Forecast["days"][number]) => number) => days.find((d) => pick(d) < 0)?.date ?? null;

  return {
    days,
    events,
    startCents,
    endCents: days[days.length - 1].balanceCents,
    endWithSpendingCents: days[days.length - 1].withSpendingCents,
    lowest: lowestOf((d) => d.balanceCents),
    lowestWithSpending: lowestOf((d) => d.withSpendingCents),
    goesNegativeOn: firstBelowZero((d) => d.balanceCents),
    goesNegativeWithSpendingOn: firstBelowZero((d) => d.withSpendingCents),
    typicalDailySpendCents,
    accountCount: cash.length,
    horizonDays,
  };
}
