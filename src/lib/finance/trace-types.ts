// Client-safe: what "Trace history" shows for one transaction.

export interface TraceRef {
  id: number;
  date: string;
  amountCents: number;
}

export interface TraceReport {
  transactionId: number;
  merchant: { key: string | null; name: string };
  /** All non-excluded, non-transfer transactions with this merchant_key, all time. */
  stats: {
    count: number;
    firstDate: string;
    lastDate: string;
    totalSpentCents: number;
    totalReceivedCents: number;
    /** Absolute amounts, expenses only (0 when there are none). */
    medianCents: number;
    minCents: number;
    maxCents: number;
    last12MonthsSpentCents: number;
    /** Over the months with any spending in the last 12. */
    averageMonthlyCents: number;
  };
  /** This transaction against the merchant's others of the same direction. */
  position: { percentile: number; vsMedianPct: number | null; isLargest: boolean; isFirst: boolean };
  cadence: { cadence: "weekly" | "biweekly" | "monthly" | "yearly"; nextExpected: string | null } | null;
  /** Lasting price steps, oldest first. */
  priceChanges: Array<{ date: string; fromCents: number; toCents: number }>;
  /** The last 24 months, newest first (months without spending included). */
  byMonth: Array<{ month: string; spentCents: number; count: number }>;
  related: {
    refunds: TraceRef[];
    possibleDuplicates: TraceRef[];
    transferPair: { id: number } | null;
  };
  similarMerchants: Array<{ key: string; name: string; count: number }>;
  /** How this merchant's rows are categorized (shows inconsistency). */
  categories: Array<{ name: string; count: number }>;
  /** The first enabled rule that matches this transaction. */
  rule: { id: number; name: string } | null;
}
