import { describe, expect, it } from "vitest";
import { guessAccountType } from "@/lib/finance/account-type";

describe("guessAccountType", () => {
  it.each([
    ["Chase Sapphire Preferred", "Chase", "credit"],
    ["Platinum Card", "American Express", "credit"],
    ["Visa Signature", "", "credit"],
    ["Total Checking", "Chase", "checking"],
    ["Everyday Checking", "", "checking"],
    ["High Yield Savings", "Ally", "savings"],
    ["Money Market", "", "savings"],
    ["Roth IRA", "Fidelity", "investment"],
    ["401(k)", "Vanguard", "investment"],
    ["Auto Loan", "", "loan"],
    ["Home Mortgage", "", "loan"],
    ["Mystery", "Some Bank", "other"],
  ])("%s (%s) → %s", (name, org, expected) => {
    expect(guessAccountType(name, org)).toBe(expected);
  });

  it("prefers the account name over the institution", () => {
    expect(guessAccountType("Savings", "Capital One Credit Union")).toBe("savings");
  });
});
