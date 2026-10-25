import { describe, expect, it } from "vitest";
import { balanceSnapshots } from "@/db/schema";
import { getAccountsOverview } from "@/lib/finance/accounts-overview";
import { convertCents, foreignCurrencies, getRates, scaleFor, setRates } from "@/lib/finance/currency";
import { zonedDayStart } from "@/lib/finance/dates";
import { getNetWorthSeries, getNetWorthSummary } from "@/lib/finance/networth";
import { setSetting } from "@/lib/settings";
import { addAccount, freshDb } from "../helpers/db";

const TZ = "UTC";
const NOW = zonedDayStart("2026-10-24", TZ) + 12 * 3600;

function dataset() {
  const db = freshDb();
  addAccount(db, "usd", { balanceCents: 100_000, currency: "USD" });
  addAccount(db, "eur", { balanceCents: 50_000, currency: "EUR" });
  addAccount(db, "gbp", { balanceCents: 10_000, currency: "GBP" });
  for (const [id, cents] of [
    ["usd", 100_000],
    ["eur", 50_000],
    ["gbp", 10_000],
  ] as const)
    db.insert(balanceSnapshots).values({ accountId: id, date: "2026-10-24", balanceCents: cents }).run();
  return db;
}

describe("rates", () => {
  it("are stored, validated and never include dollars", () => {
    const db = dataset();
    expect(getRates(db)).toEqual({});
    expect(setRates(db, { EUR: 1.0856, USD: 5 })).toEqual({ EUR: 1.0856 });
    expect(getRates(db)).toEqual({ EUR: 1.0856 });
    for (const bad of [
      { eur: 1 },
      { EUR: 0 },
      { EUR: -2 },
      { EUR: 1.0000001 },
      { EUR: 2_000_000 },
      { EURO: 1 },
      { EUR: "1.1" },
    ])
      expect(() => setRates(db, bad)).toThrow();
    expect(getRates(db)).toEqual({ EUR: 1.0856 }); // a failed save changes nothing
  });

  it("treat damaged saved data as no rates", () => {
    const db = dataset();
    setSetting(db, "fx:rates", "{not json");
    expect(getRates(db)).toEqual({});
    setSetting(db, "fx:rates", JSON.stringify({ EUR: "abc" }));
    expect(getRates(db)).toEqual({});
  });

  it("convert, rounding to the cent, and pass dollars and unknown currencies through", () => {
    expect(convertCents(10_000, "EUR", { EUR: 1.0856 })).toBe(10_856);
    expect(convertCents(3, "EUR", { EUR: 1.5 })).toBe(5); // 4.5 rounds up
    expect(convertCents(-10_000, "EUR", { EUR: 1.0856 })).toBe(-10_856);
    expect(convertCents(10_000, "USD", { USD: 9 })).toBe(10_000);
    expect(convertCents(10_000, "JPY", {})).toBe(10_000);
  });

  it("lists the foreign currencies in use with their rates", () => {
    const db = dataset();
    setRates(db, { EUR: 1.1 });
    expect(foreignCurrencies(db)).toEqual([
      { currency: "EUR", accountCount: 1, rate: 1.1 },
      { currency: "GBP", accountCount: 1, rate: null },
    ]);
    expect(scaleFor(db, ["usd", "eur", "gbp"])).toEqual(new Map([["eur", 1.1]]));
    expect(scaleFor(db, ["usd"])).toBeUndefined();
    expect(scaleFor(db, [])).toBeUndefined();
  });
});

describe("net worth and account totals", () => {
  it("convert foreign balances at your rates and say which were converted", () => {
    const db = dataset();
    setRates(db, { EUR: 1.1 });
    const s = getNetWorthSummary(db, "1M", NOW, TZ);
    // $1,000 + EUR 500 * 1.1 = $550 + GBP 100 with no rate yet, counted 1 to 1
    expect(s.totalCents).toBe(100_000 + 55_000 + 10_000);
    expect(s.converted).toEqual([
      { currency: "EUR", rate: 1.1 },
      { currency: "GBP", rate: null },
    ]);
    expect(getNetWorthSeries(db, "1M", NOW, TZ).at(-1)?.balanceCents).toBe(165_000);
  });

  it("convert the history too, so the chart and the total agree", () => {
    const db = dataset();
    setRates(db, { EUR: 2, GBP: 1.25 });
    const series = getNetWorthSeries(db, "1M", NOW, TZ);
    expect(series.at(-1)?.balanceCents).toBe(100_000 + 100_000 + 12_500);
    const s = getNetWorthSummary(db, "1M", NOW, TZ);
    expect(s.totalCents).toBe(series.at(-1)?.balanceCents);
  });

  it("add up account groups in dollars", () => {
    const db = dataset();
    setRates(db, { EUR: 1.1, GBP: 1.25 });
    const [group] = getAccountsOverview(db, NOW, TZ);
    expect(group.totalCents).toBe(100_000 + 55_000 + 12_500);
    // each account still shows its own balance in its own currency
    expect(group.accounts.find((a) => a.id === "eur")).toMatchObject({ balanceCents: 50_000, currency: "EUR" });
  });

  it("nothing changes for a dollars-only setup", () => {
    const db = freshDb();
    addAccount(db, "a", { balanceCents: 12_345 });
    expect(getNetWorthSummary(db, "1M", NOW, TZ)).toMatchObject({ totalCents: 12_345, converted: [] });
  });
});
