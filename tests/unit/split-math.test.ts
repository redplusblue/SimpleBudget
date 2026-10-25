import { describe, expect, it } from "vitest";
import { parseCents } from "@/lib/finance/cents";
import { splitRemaining, type DraftPart } from "@/components/register/split-math";

const part = (amount: string): DraftPart => ({ categoryId: null, amount, notes: "" });

describe("splitRemaining", () => {
  it("is valid only when two or more positive parts add up exactly", () => {
    expect(splitRemaining([part("70"), part("30.00")], 10_000, parseCents)).toMatchObject({
      remainingCents: 0,
      valid: true,
      centsList: [7_000, 3_000],
    });
    expect(splitRemaining([part("70"), part("20")], 10_000, parseCents)).toMatchObject({
      remainingCents: 1_000,
      valid: false,
    });
    expect(splitRemaining([part("70"), part("40")], 10_000, parseCents)).toMatchObject({
      remainingCents: -1_000,
      valid: false,
    });
    expect(splitRemaining([part("100")], 10_000, parseCents).valid).toBe(false);
    expect(splitRemaining([part("100"), part("0")], 10_000, parseCents).valid).toBe(false);
  });

  it("treats blanks as zero, accepts $ and signs, and flags unparsable text", () => {
    expect(splitRemaining([part("$60"), part("")], 10_000, parseCents)).toMatchObject({
      remainingCents: 4_000,
      valid: false,
    });
    expect(splitRemaining([part("-60"), part("40")], 10_000, parseCents).valid).toBe(true); // sign is applied from the transaction
    expect(splitRemaining([part("abc"), part("100")], 10_000, parseCents).valid).toBe(false);
    expect(splitRemaining([part("33.335"), part("66.67")], 10_000, parseCents).valid).toBe(false);
  });
});
