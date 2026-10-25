// Client-safe shapes for the cash-flow forecast.

export interface ForecastEvent {
  /** `YYYY-MM-DD` */
  date: string;
  name: string;
  /** Positive for money in, negative for money out. */
  amountCents: number;
  kind: "bill" | "income";
}

export interface ForecastDay {
  date: string;
  /** Balance at the end of the day counting only the recurring bills and income. */
  balanceCents: number;
  /** The same, after also subtracting the typical day-to-day spending. */
  withSpendingCents: number;
}

export interface Forecast {
  /** First day is today. */
  days: ForecastDay[];
  events: ForecastEvent[];
  startCents: number;
  endCents: number;
  endWithSpendingCents: number;
  lowest: { date: string; balanceCents: number };
  lowestWithSpending: { date: string; balanceCents: number };
  /** First day the recurring-only balance drops below zero, or null. */
  goesNegativeOn: string | null;
  goesNegativeWithSpendingOn: string | null;
  /** Average per day over the last 90 days, excluding recurring bills. */
  typicalDailySpendCents: number;
  /** How many cash accounts (checking, savings, cash) the balance adds up. */
  accountCount: number;
  horizonDays: number;
}
