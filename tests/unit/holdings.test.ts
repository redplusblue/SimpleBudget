import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { holdings } from "@/db/schema";
import { addConnection } from "@/lib/connections";
import { getHoldings } from "@/lib/finance/holdings";
import { parseHoldings } from "@/lib/simplefin/parse";
import { runSync } from "@/lib/simplefin/sync";
import { addAccount, freshDb } from "../helpers/db";
import { ACCESS_URL, mockBank, NOW } from "../helpers/simplefin-mock";

describe("parseHoldings", () => {
  it("reads what banks send and skips what it can't", () => {
    const out = parseHoldings(
      [
        {
          id: "h1",
          symbol: " VTI ",
          description: "Total Market",
          shares: "10.5",
          market_value: "1,000.50".replace(",", ""),
          cost_basis: "900.25",
          currency: "USD",
        },
        { id: 2, symbol: "CASH", market_value: 55, shares: null, cost_basis: "" },
        { id: "bad", market_value: "n/a" },
        { symbol: "NOID", market_value: "1.00" },
        "junk",
      ],
      "EUR",
    );
    expect(out).toEqual([
      {
        sfId: "h1",
        symbol: "VTI",
        description: "Total Market",
        shares: "10.5",
        marketValueCents: 100050,
        costBasisCents: 90025,
        currency: "USD",
      },
      {
        sfId: "2",
        symbol: "CASH",
        description: "",
        shares: "0",
        marketValueCents: 5500,
        costBasisCents: null,
        currency: "EUR",
      },
    ]);
  });

  it("is undefined when the institution sends no holdings", () => {
    expect(parseHoldings(undefined, "USD")).toBeUndefined();
    expect(parseHoldings([], "USD")).toEqual([]);
  });
});

describe("getHoldings", () => {
  const put = (db: ReturnType<typeof freshDb>, sfId: string, symbol: string, value: number, cost: number | null) =>
    db
      .insert(holdings)
      .values({
        accountId: "inv",
        sfId,
        symbol,
        description: symbol,
        shares: "1",
        marketValueCents: value,
        costBasisCents: cost,
      })
      .run();

  it("sorts by value and works out weights and gains", () => {
    const db = freshDb();
    addAccount(db, "inv", { type: "investment" });
    put(db, "a", "SMALL", 10_000, 12_500);
    put(db, "b", "BIG", 70_000, 50_000);
    put(db, "c", "CASH", 20_000, null);
    const s = getHoldings(db, "inv");
    expect(s.holdings.map((h) => h.symbol)).toEqual(["BIG", "CASH", "SMALL"]);
    expect(s.holdings.map((h) => h.weight)).toEqual([0.7, 0.2, 0.1]);
    expect(s.holdings[0]).toMatchObject({ gainCents: 20_000, gainPct: 0.4 });
    expect(s.holdings[1]).toMatchObject({ gainCents: null, gainPct: null });
    expect(s.holdings[2]).toMatchObject({ gainCents: -2_500, gainPct: -0.2 });
    // the total gain only covers positions whose cost is known: (70k + 10k) - (50k + 12.5k)
    expect(s).toMatchObject({
      totalValueCents: 100_000,
      knownCostCents: 62_500,
      knownValueCents: 80_000,
      totalGainCents: 17_500,
    });
    expect(s.totalGainPct).toBeCloseTo(0.28);
  });

  it("is empty for an account with none", () => {
    const db = freshDb();
    addAccount(db, "inv");
    expect(getHoldings(db, "inv")).toMatchObject({
      holdings: [],
      totalValueCents: 0,
      totalGainCents: null,
      asOf: null,
    });
  });
});

describe("syncing holdings", () => {
  function setup() {
    const db = createDb(openSqlite(":memory:"));
    runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
    addConnection(db, ACCESS_URL);
    const bank = mockBank();
    const sync = () =>
      runSync(db, {
        mode: "backfill",
        days: 30,
        trigger: "scheduled",
        now: NOW,
        fetchImpl: bank.fetch,
        sleep: async () => {},
        timeZone: "UTC",
      });
    return { db, bank, sync };
  }
  const symbols = (db: ReturnType<typeof setup>["db"]) =>
    db
      .select()
      .from(holdings)
      .all()
      .map((h) => [h.symbol, h.marketValueCents])
      .sort();

  it("stores positions, updates them on the next sync and removes sold ones", async () => {
    const { db, bank, sync } = setup();
    const target = bank.accounts[2]; // the savings fixture stands in for a brokerage
    target.holdings = [
      { id: "1", symbol: "AAA", description: "A", shares: "2", market_value: "100.00", cost_basis: "80.00" },
      { id: "2", symbol: "BBB", description: "B", shares: "1", market_value: "50.00" },
    ];
    await sync();
    expect(symbols(db)).toEqual([
      ["AAA", 10_000],
      ["BBB", 5_000],
    ]);

    target.holdings = [
      { id: "1", symbol: "AAA", description: "A", shares: "2", market_value: "130.00", cost_basis: "80.00" },
    ];
    await sync();
    expect(symbols(db)).toEqual([["AAA", 13_000]]); // updated, and BBB (sold) is gone
    expect(db.select().from(holdings).all()).toHaveLength(1);
  });

  it("leaves stored positions alone when a response carries no holdings field", async () => {
    const { db, bank, sync } = setup();
    bank.accounts[2].holdings = [{ id: "1", symbol: "AAA", market_value: "100.00" }];
    await sync();
    delete bank.accounts[2].holdings;
    await sync();
    expect(symbols(db)).toEqual([["AAA", 10_000]]);
  });
});
