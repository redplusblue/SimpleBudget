import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatCents, MoneyParseError, parseCents } from "@/lib/finance/cents";

describe("parseCents", () => {
  it.each([
    ["12.3", 1230],
    ["1234", 123400],
    ["-0.5", -50],
    ["+7.01", 701],
    ["-1234.56", -123456],
    ["0", 0],
    ["-0.00", 0],
    [".5", 50],
    ["5.", 500],
    ["12.50", 1250],
    ["12.500", 1250],
    ["  3.10 ", 310],
    ["0.07", 7],
    ["19.99", 1999],
    ["1.15", 115],
  ])("parses %s → %d", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it.each(["1,234.56", "12.345", "abc", "", "1e3", "--1", "$5", "1.2.3", "."])("rejects %j", (input) => {
    expect(() => parseCents(input)).toThrow(MoneyParseError);
  });

  it("never loses precision on values float math breaks", () => {
    expect(parseCents("0.29")).toBe(29);
    expect(parseCents("4.35")).toBe(435);
  });

  it("returns 0, not -0", () => {
    expect(Object.is(parseCents("-0"), 0)).toBe(true);
  });
});

describe("centsToDecimalString", () => {
  it("round-trips", () => {
    for (const s of ["-1234.56", "0.05", "10.00", "-0.99"]) {
      expect(centsToDecimalString(parseCents(s))).toBe(s);
    }
  });
});

describe("formatCents", () => {
  it("formats USD", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-50)).toBe("-$0.50");
  });
  it("supports compact", () => {
    expect(formatCents(1240000, { compact: true })).toBe("$12.4K");
  });
  it("supports explicit sign", () => {
    expect(formatCents(500, { signDisplay: "always" })).toBe("+$5.00");
    expect(formatCents(-500, { signDisplay: "never" })).toBe("$5.00");
  });
  it("hides zero cents on request", () => {
    expect(formatCents(1200, { hideZeroCents: true })).toBe("$12");
    expect(formatCents(1205, { hideZeroCents: true })).toBe("$12.05");
  });
  it("falls back to USD for non-ISO currency codes", () => {
    expect(formatCents(100, { currency: "https://example.com/pts" })).toBe("$1.00");
  });
});
