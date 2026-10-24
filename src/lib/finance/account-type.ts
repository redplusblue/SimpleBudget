import type { AccountType } from "./account-types";

const RULES: ReadonlyArray<[AccountType, RegExp]> = [
  ["credit", /\b(credit|card|visa|mastercard|amex|american express|discover|sapphire|freedom|platinum)\b/i],
  ["loan", /\b(loan|mortgage|auto|student|heloc|line of credit)\b/i],
  ["investment", /\b(invest|brokerage|401\s?\(?k\)?|403\(?b\)?|ira|roth|retirement|stock|crypto|hsa)\b/i],
  ["savings", /\b(saving|savings|money market|mm|high.?yield|cd|certificate)\b/i],
  ["checking", /\b(checking|chequing|current|everyday|spending|debit)\b/i],
  ["cash", /\bcash\b/i],
];

/** Best guess from an account's name (and org); users can override it. Falls back to `other`. */
export function guessAccountType(name: string, orgName = ""): AccountType {
  // The account name is more specific than the institution, so try it first.
  for (const text of [name, `${name} ${orgName}`]) {
    for (const [type, re] of RULES) if (re.test(text)) return type;
  }
  return "other";
}
