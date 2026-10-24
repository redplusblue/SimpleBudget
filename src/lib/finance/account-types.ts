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

export type AccountGroupKey = "cash" | "credit" | "investments" | "loans" | "other" | "closed";

export const ACCOUNT_GROUP_LABELS: Record<AccountGroupKey, string> = {
  cash: "Cash",
  credit: "Credit",
  investments: "Investments",
  loans: "Loans",
  other: "Other",
  closed: "Closed",
};

export const ACCOUNT_GROUP_ORDER: AccountGroupKey[] = ["cash", "credit", "investments", "loans", "other", "closed"];

export function groupKeyFor(type: AccountType, isClosed: boolean): AccountGroupKey {
  if (isClosed) return "closed";
  switch (type) {
    case "checking":
    case "savings":
    case "cash":
      return "cash";
    case "credit":
      return "credit";
    case "investment":
      return "investments";
    case "loan":
      return "loans";
    default:
      return "other";
  }
}
