import { describe, expect, it, vi } from "vitest";
import {
  ExchangeRateError,
  getDisplayCurrency,
  getMarketRates,
  parseMarketRates,
  refreshMarketRates,
  RATES_URL,
  setDisplayCurrency,
} from "@/lib/finance/exchange-rates";
import { freshDb } from "../helpers/db";

function body(over: Record<string, unknown> = {}) {
  const rates: Record<string, number> = { USD: 1, EUR: 0.9, GBP: 0.78, INR: 84.5, CAD: 1.38, MXN: 19.5 };
  for (let i = 0; i < 30; i++)
    rates[`X${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`] = 2 + i;
  return { result: "success", base_code: "USD", rates, ...over };
}
const ok = (b: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(b), { status: 200 })) as unknown as typeof fetch;

describe("parseMarketRates", () => {
  it("keeps valid rates, drops junk, always has USD = 1", () => {
    const m = parseMarketRates(body({ rates: { ...body().rates, BAD: -1, NAN: "x", lower: 3 } }), 100);
    expect(m.rates.INR).toBe(84.5);
    expect(m.rates.BAD).toBeUndefined();
    expect(m.rates.NAN).toBeUndefined();
    expect(m.rates.lower).toBeUndefined();
    expect(m.rates.USD).toBe(1);
  });
  it("rejects a wrong base, a failure, and a truncated list", () => {
    expect(() => parseMarketRates(body({ base_code: "EUR" }), 1)).toThrow(ExchangeRateError);
    expect(() => parseMarketRates(body({ result: "error" }), 1)).toThrow(ExchangeRateError);
    expect(() => parseMarketRates({ result: "success", base_code: "USD", rates: { EUR: 0.9 } }, 1)).toThrow(
      ExchangeRateError,
    );
    expect(() => parseMarketRates("nope", 1)).toThrow(ExchangeRateError);
  });
});

describe("refreshMarketRates", () => {
  it("stores the rates and calls only the fixed URL", async () => {
    const db = freshDb();
    const f = ok(body());
    await refreshMarketRates(db, 1000, f);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(RATES_URL);
    expect(getMarketRates(db)?.updatedAt).toBe(1000);
  });
  it("keeps the old rates when the service fails or returns garbage", async () => {
    const db = freshDb();
    await refreshMarketRates(db, 1000, ok(body()));
    await expect(
      refreshMarketRates(db, 2000, vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch),
    ).rejects.toThrow(ExchangeRateError);
    await expect(refreshMarketRates(db, 2000, ok({ result: "success", base_code: "USD", rates: {} }))).rejects.toThrow(
      ExchangeRateError,
    );
    await expect(
      refreshMarketRates(
        db,
        2000,
        vi.fn(async () => {
          throw new Error("secret-host down");
        }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Couldn't reach the rates service");
    expect(getMarketRates(db)?.updatedAt).toBe(1000);
  });
});

describe("display currency preference", () => {
  it("is dollars until enabled, and only offers currencies that have a rate", async () => {
    const db = freshDb();
    expect(getDisplayCurrency(db)).toMatchObject({ enabled: false, code: "USD", rate: 1, available: [] });
    expect(() => setDisplayCurrency(db, { code: "INR" })).toThrow("No exchange rate");
    await refreshMarketRates(db, 1000, ok(body()));
    expect(getDisplayCurrency(db).available).toContain("INR");
    setDisplayCurrency(db, { code: "INR" });
    expect(getDisplayCurrency(db)).toMatchObject({ enabled: false, code: "USD", rate: 1 });
    expect(setDisplayCurrency(db, { enabled: true })).toMatchObject({ enabled: true, code: "INR", rate: 84.5 });
    expect(setDisplayCurrency(db, { enabled: false })).toMatchObject({ code: "USD", rate: 1 });
  });
  it("rejects malformed codes", () => {
    expect(() => setDisplayCurrency(freshDb(), { code: "inr" })).toThrow();
    expect(() => setDisplayCurrency(freshDb(), { code: "'; DROP" })).toThrow();
  });
});
