// Client-safe shapes for the year-in-review page.

export interface YearMonth {
  /** `YYYY-MM` */
  month: string;
  spentCents: number;
  incomeCents: number;
}

export interface YearRanked {
  id: number | null;
  name: string;
  cents: number;
  /** Share of the year's spending (0-1). */
  share: number;
  count: number;
}

export interface YearMover {
  name: string;
  cents: number;
  previousCents: number;
  deltaCents: number;
}

export interface YearInReview {
  year: number;
  /** The year isn't over, so numbers cover January up to today. */
  partial: boolean;
  /** Years that have any transactions, newest first (for the picker). */
  availableYears: number[];
  spentCents: number;
  incomeCents: number;
  /** (income - spent) / income, or null with no income. */
  savingsRate: number | null;
  previousSpentCents: number;
  previousIncomeCents: number;
  purchaseCount: number;
  avgPerDayCents: number;
  /** Days so far in the year on which nothing was spent. */
  noSpendDays: number;
  daysCounted: number;
  months: YearMonth[];
  priciestMonth: YearMonth | null;
  cheapestMonth: YearMonth | null;
  topCategories: YearRanked[];
  topMerchants: YearRanked[];
  /** Categories whose spending grew the most compared with the year before. */
  risers: YearMover[];
  fallers: YearMover[];
  biggestPurchase: { name: string; amountCents: number; date: string } | null;
  busiestDay: { date: string; cents: number } | null;
  /** Net worth at the start and end of the year, when there is history for it. */
  netWorth: { startCents: number; endCents: number; changeCents: number } | null;
  /** What the detected subscriptions and regular bills cost over a year at today's prices. */
  recurringYearlyCents: number;
  recurringCount: number;
}
