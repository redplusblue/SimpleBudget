import type { DbLike } from "@/db/open";
import { accounts } from "@/db/schema";
import { count } from "drizzle-orm";
import { getAccountsOverview } from "./accounts-overview";
import type { DashboardPayload, UpcomingSummary } from "./dashboard-types";
import { currentMonth, localDateString } from "./dates";
import { detectRecurring, upcomingCharges } from "./recurring";
import { DEFAULT_NET_WORTH_RANGE, getNetWorthSummary } from "./networth";
import { getTargetProgress } from "./targets";
import { getCategoryBreakdown, getMonthlySpending } from "./spending";
import { queryTransactions } from "./transactions-query";

export const RECENT_COUNT = 8;
export const UPCOMING_DAYS = 30;
export const UPCOMING_LIMIT = 5;

/** Everything the home page needs in one payload, computed with SQL aggregates. */
export function getDashboard(db: DbLike, opts: { month?: string; now: number; timeZone: string }): DashboardPayload {
  const { now, timeZone } = opts;
  const month = opts.month ?? currentMonth(now, timeZone);
  const { glance, chart } = getMonthlySpending(db, month, now, timeZone);
  return {
    month,
    generatedAt: now,
    timeZone,
    hasAccounts: (db.select({ n: count() }).from(accounts).get()?.n ?? 0) > 0,
    netWorth: getNetWorthSummary(db, DEFAULT_NET_WORTH_RANGE, now, timeZone),
    glance,
    spending: chart,
    categories: getCategoryBreakdown(db, month, timeZone),
    recent: queryTransactions(db, {}, { limit: RECENT_COUNT, timeZone, includeTotal: false }).rows,
    targets: getTargetProgress(db, month, now, timeZone),
    accounts: getAccountsOverview(db, now, timeZone),
  };
}

/**
 * The next recurring charges. Detecting subscriptions reads a year of history, so this is its own request: the
 * dashboard shows it when the card scrolls into view instead of making every page load wait for it.
 */
export function getUpcoming(db: DbLike, now: number, timeZone: string): UpcomingSummary {
  const recurring = detectRecurring(db, now, timeZone);
  return {
    items: upcomingCharges(recurring, localDateString(now, timeZone), UPCOMING_DAYS, UPCOMING_LIMIT),
    monthlyTotalCents: recurring.monthlyTotalCents,
    activeCount: recurring.items.length,
  };
}
