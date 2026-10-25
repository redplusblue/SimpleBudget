// Client-safe shapes for recurring charges.

export type Cadence = "weekly" | "biweekly" | "monthly" | "yearly";

export interface RecurringItem {
  /** transactions.merchant_key */
  key: string;
  name: string;
  cadence: Cadence;
  /** The current (most recent) charge. */
  amountCents: number;
  /** The typical charge before the most recent one, when the price changed. */
  previousAmountCents: number | null;
  /** Price went up by this fraction (e.g. 0.1 = +10%), otherwise null. */
  increasePct: number | null;
  count: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  /** What this costs per month on average. */
  monthlyCostCents: number;
  /** False when the next charge is long overdue, i.e. it was probably cancelled. */
  active: boolean;
  /** Days past the expected date (0 when not late). */
  overdueDays: number;
  accountId: string;
  categoryId: number | null;
}

export interface RecurringReport {
  /** Still-active charges, soonest next date first. */
  items: RecurringItem[];
  /** Detected but apparently cancelled. */
  inactive: RecurringItem[];
  monthlyTotalCents: number;
  yearlyTotalCents: number;
}
