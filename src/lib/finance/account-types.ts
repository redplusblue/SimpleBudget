// Client-safe (no DB imports) so UI code can use the list and labels.
export const ACCOUNT_TYPES = ["checking", "savings", "credit", "investment", "loan", "cash", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
  other: "Other",
};
