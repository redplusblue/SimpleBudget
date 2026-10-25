// Client-safe shapes for GET /api/spending.

export interface ReportRange {
  kind: "month" | "custom";
  /** `YYYY-MM`, for month ranges. */
  month?: string;
  /** Inclusive local dates, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** Number of calendar days in the range. */
  days: number;
  /** Days that have happened so far (equals `days` for past ranges). */
  elapsedDays: number;
  label: string;
  isCurrent: boolean;
  /** What spending is compared with: the previous calendar month, or an equally long period right before. */
  previous: { from: string; to: string; label: string };
}

export interface ReportSummary {
  spentCents: number;
  incomeCents: number;
  netCents: number;
  /** (income - spent) / income, or null with no income. */
  savingsRate: number | null;
  /** Number of purchases (expense transactions) in the range. */
  purchaseCount: number;
  /** Spending per elapsed day. */
  avgPerDayCents: number;
  largest: { id: number; name: string; amountCents: number; date: string } | null;
  previousSpentCents: number;
  previousIncomeCents: number;
}

export interface CategoryComparison {
  id: number | null;
  name: string;
  color: string;
  cents: number;
  previousCents: number;
  /** Average of the three months before, for month ranges only. */
  averageCents: number | null;
  deltaPreviousCents: number;
  deltaAverageCents: number | null;
}

export interface CategoryBreakdownRow {
  id: number | null;
  name: string;
  color: string;
  cents: number;
  share: number;
  count: number;
  /** Monthly spending for the six months ending with the range's last month, oldest first. */
  trend: number[];
}

export interface TagBreakdownRow {
  id: number;
  name: string;
  color: string;
  cents: number;
  count: number;
}

export interface MerchantRow {
  key: string;
  name: string;
  cents: number;
  count: number;
  avgCents: number;
}

export interface AccountBreakdownRow {
  id: string;
  name: string;
  color: string | null;
  cents: number;
  share: number;
  count: number;
}

export interface DailySpend {
  date: string;
  cents: number;
  /** After today: nothing can have been spent yet. */
  future: boolean;
}

export interface WeekdayRow {
  /** 0 = Sunday ... 6 = Saturday */
  dow: number;
  cents: number;
  /** Days of this weekday that have happened in the range. */
  occurrences: number;
  /** Average spend on such a day. */
  avgCents: number;
}

export interface TrendSeries {
  id: number | null;
  name: string;
  color: string;
  values: number[];
}

export interface TrendReport {
  /** `YYYY-MM`, oldest first, ending with the range's last month. */
  months: string[];
  series: TrendSeries[];
  incomeCents: number[];
}

export interface SpendingReport {
  range: ReportRange;
  summary: ReportSummary;
  comparison: CategoryComparison[];
  categories: CategoryBreakdownRow[];
  tags: TagBreakdownRow[];
  merchants: MerchantRow[];
  accounts: AccountBreakdownRow[];
  daily: DailySpend[];
  weekdays: WeekdayRow[];
  trends: TrendReport;
}
