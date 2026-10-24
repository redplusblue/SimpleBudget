import type { DbLike } from "@/db/open";
import { accounts } from "@/db/schema";
import { count } from "drizzle-orm";
import { getAccountsOverview } from "./accounts-overview";
import type { DashboardPayload } from "./dashboard-types";
import { currentMonth } from "./dates";
import { DEFAULT_NET_WORTH_RANGE, getNetWorthSummary } from "./networth";
import { getCategoryBreakdown, getMonthlySpending } from "./spending";
import { queryTransactions } from "./transactions-query";

export const RECENT_COUNT = 8;

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
    accounts: getAccountsOverview(db, now, timeZone),
  };
}
