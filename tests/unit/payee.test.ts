import { describe, expect, it } from "vitest";
import { normalizePayee, payeeKey } from "@/lib/finance/payee";

describe("normalizePayee", () => {
  it.each([
    ["SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA", "BLUE BOTTLE COFFEE"],
    ["TST* TACO PLACE", "TACO PLACE"],
    ["TRADER JOE'S #552 AUSTIN TX", "TRADER JOE'S"],
    ["POS DEBIT TARGET 00012345", "TARGET"],
    ["CHECKCARD 0412 SHELL OIL 57444 AUSTIN TX", "SHELL OIL"],
    ["PURCHASE AUTHORIZED ON 10/12 NETFLIX.COM LOS GATOS CA CARD 1234", "NETFLIX.COM"],
    ["AMAZON MKTPLACE PMTS AMZN.COM/BILL WA", "AMAZON MKTPLACE PMTS AMZN.COM/BILL"],
    ["DOORDASH*THAI HOUSE", "DOORDASH THAI HOUSE"],
    ["PAYPAL *SPOTIFY 402-935-7733", "SPOTIFY"],
    ["GOOGLE *YOUTUBE PREMIUM", "YOUTUBE PREMIUM"],
    ["STARBUCKS STORE 12345 NEW YORK NY", "STARBUCKS"],
    ["WALMART SUPERCENTER #1234 BENTONVILLE AR", "WALMART SUPERCENTER"],
    ["COSTCO WHSE #0123 SEATTLE WA", "COSTCO WHSE"],
    ["CVS/PHARMACY #9921", "CVS/PHARMACY"],
    ["SQ *COFFEE SHOP 4829", "COFFEE SHOP"],
    ["  whole   foods  #123  ", "whole foods"],
    ["WHOLE FOODS MARKET AUSTIN TX", "WHOLE FOODS MARKET"],
    ["UBER *TRIP", "UBER TRIP"],
    ["RECURRING PAYMENT HULU 877-824-4858 CA", "HULU"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePayee(input)).toBe(expected);
  });

  it("leaves already-clean names alone", () => {
    for (const s of [
      "ACME CORP PAYROLL DIRECT DEP",
      "ZELLE TO LANDLORD JANE",
      "CHASE CREDIT CRD AUTOPAY",
      "APPLE.COM/BILL",
      "Trader Joe's",
    ]) {
      expect(normalizePayee(s)).toBe(s);
    }
  });

  it("never returns an empty result for non-empty input", () => {
    expect(normalizePayee("12345")).toBe("12345");
    expect(normalizePayee("SQ *")).toBe("SQ *");
    expect(normalizePayee("#552")).toBe("#552");
    expect(normalizePayee("")).toBe("");
    expect(normalizePayee("   ")).toBe("");
  });

  it("keeps a short state-like word that isn't a location", () => {
    expect(normalizePayee("PAYMENT THANK YOU")).toBe("PAYMENT THANK YOU");
    expect(normalizePayee("FEE IN")).toBe("FEE IN"); // too short to contain a location
    expect(normalizePayee("Cafe de la Paix")).toBe("Cafe de la Paix"); // lowercase 'la' is not a state
  });

  it("is idempotent", () => {
    for (const s of [
      "SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA",
      "TRADER JOE'S #552 AUSTIN TX",
      "PAYPAL *SPOTIFY 402-935-7733",
    ]) {
      expect(normalizePayee(normalizePayee(s))).toBe(normalizePayee(s));
    }
  });
});

describe("payeeKey", () => {
  it("groups spelling and punctuation variants together", () => {
    expect(payeeKey("Trader Joe's")).toBe(payeeKey("TRADER JOES #552 AUSTIN TX"));
    expect(payeeKey("SQ *Blue Bottle Coffee")).toBe(payeeKey("BLUE BOTTLE COFFEE SAN FRANCISCO CA"));
    expect(payeeKey("Netflix")).not.toBe(payeeKey("Hulu"));
  });
});
