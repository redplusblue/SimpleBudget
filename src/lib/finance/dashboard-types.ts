// Client-safe shapes for GET /api/dashboard.
import type { AccountGroup } from "./accounts-overview";
import type { RecurringItem } from "./recurring-types";
import type { Insight } from "@/lib/insights/types";
import type { TargetProgress } from "./targets-types";
import type { NetWorthSummary } from "./networth";
import type { TransactionRow } from "./transaction-types";

export interface MonthGlance {
  /** `YYYY-MM` */
  month: string;
  isCurrent: boolean;
  spentCents: number;
  incomeCents: number;
  netCents: number;
  /** Spending so far vs the same point last month. Only for the current month. */
  pace: {
    /** How many days of the month have elapsed (1-based, today inclusive). */
    dayOfMonth: number;
    lastMonthToDateCents: number;
    /** spent so far minus last month at this point: negative = spending less than last month. */
    deltaCents: number;
  } | null;
}

export interface SpendingPoint {
  day: number;
  /** Cumulative spend this month; `null` for days that haven't happened yet. */
  current: number | null;
  /** Cumulative spend last month; `null` after its last day. */
  last: number | null;
  /** Average cumulative spend of the three months before this one. */
  average: number | null;
}

export interface SpendingChart {
  month: string;
  lastMonth: string;
  points: SpendingPoint[];
  /** Whether last month / the average have any spending to compare with. */
  hasComparison: boolean;
}

export interface CategorySlice {
  /** `null` = uncategorized */
  id: number | null;
  name: string;
  color: string;
  cents: number;
  /** Share of the month's total spending, 0-1. */
  share: number;
  previousCents: number;
  deltaCents: number;
}

export interface CategoryBreakdown {
  totalCents: number;
  items: CategorySlice[];
  /** Spending outside the listed items, so slices always add up to the total. */
  otherCents: number;
}

export interface UpcomingCharge extends RecurringItem {
  /** Days from today until the expected date (negative when it's late). */
  inDays: number;
}

export interface UpcomingSummary {
  items: UpcomingCharge[];
  /** Everything detected as recurring, per month. */
  monthlyTotalCents: number;
  /** How many active recurring charges were detected in total. */
  activeCount: number;
}

export interface DashboardPayload {
  month: string;
  generatedAt: number;
  timeZone: string;
  hasAccounts: boolean;
  netWorth: NetWorthSummary;
  glance: MonthGlance;
  spending: SpendingChart;
  categories: CategoryBreakdown;
  recent: TransactionRow[];
  upcoming: UpcomingSummary;
  /** The three most important insights, and how many there are in all. */
  insights: { top: Insight[]; total: number };
  /** Progress for this month's spending targets; empty (and the UI shows nothing) when none are set. */
  targets: TargetProgress[];
  accounts: AccountGroup[];
}
