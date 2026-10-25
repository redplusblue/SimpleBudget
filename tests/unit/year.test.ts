import { describe, expect, it } from "vitest";
import { balanceSnapshots } from "@/db/schema";
import { zonedDayStart } from "@/lib/finance/dates";
import { availableYears, getYearInReview, YearError } from "@/lib/finance/year";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

function dataset() {
  const db = freshDb();
  addAccount(db, "A", { balanceCents: 500_000 });
  const [groceries, dining] = [categoryId(db, "Groceries"), categoryId(db, "Dining")];
  const spend = (date: string, dollars: number, description: string, categoryId?: number) =>
    addTxn(db, "A", { posted: at(date), amountCents: -dollars * 100, description, categoryId });
  spend("2024-06-10", 100, "CAFE", dining);
  spend("2025-01-10", 300, "SUPERMARKET", groceries);
  spend("2025-02-10", 200, "SUPERMARKET", groceries);
  spend("2025-02-14", 150, "FANCY DINNER", dining);
  spend("2025-03-05", 50, "CAFE", dining);
  addTxn(db, "A", { posted: at("2025-01-05"), amountCents: 400_000, description: "PAYROLL" });
  addTxn(db, "A", { posted: at("2025-02-05"), amountCents: 400_000, description: "PAYROLL" });
  spend("2026-03-03", 80, "SUPERMARKET", groceries);
  for (const [date, balanceCents] of [
    ["2025-01-01", 100_000],
    ["2025-12-31", 500_000],
    ["2026-10-24", 500_000],
  ] as const)
    db.insert(balanceSnapshots).values({ accountId: "A", date, balanceCents }).run();
  return db;
}

describe("getYearInReview", () => {
  it("summarizes a finished year", () => {
    const y = getYearInReview(dataset(), 2025, NOW, TZ);
    expect(y).toMatchObject({
      year: 2025,
      partial: false,
      spentCents: 70_000,
      incomeCents: 800_000,
      previousSpentCents: 10_000,
      purchaseCount: 4,
      daysCounted: 365,
      noSpendDays: 361,
      avgPerDayCents: Math.round(70_000 / 365),
    });
    expect(y.savingsRate).toBeCloseTo(0.9125);
    expect(y.months.slice(0, 4).map((m) => [m.month, m.spentCents, m.incomeCents])).toEqual([
      ["2025-01", 30_000, 400_000],
      ["2025-02", 35_000, 400_000],
      ["2025-03", 5_000, 0],
      ["2025-04", 0, 0],
    ]);
    expect(y.months).toHaveLength(12);
    expect(y.priciestMonth?.month).toBe("2025-02");
    expect(y.cheapestMonth?.month).toBe("2025-03");
  });

  it("ranks categories and merchants and finds what changed since the year before", () => {
    const y = getYearInReview(dataset(), 2025, NOW, TZ);
    expect(y.topCategories.map((c) => [c.name, c.cents])).toEqual([
      ["Groceries", 50_000],
      ["Dining", 20_000],
    ]);
    expect(y.topCategories[0].share).toBeCloseTo(50_000 / 70_000);
    expect(y.topMerchants[0]).toMatchObject({ name: "SUPERMARKET", cents: 50_000, count: 2 });
    expect(y.risers.map((r) => [r.name, r.deltaCents, r.previousCents])).toEqual([
      ["Groceries", 50_000, 0],
      ["Dining", 10_000, 10_000],
    ]);
    expect(y.fallers).toEqual([]);
  });

  it("finds the biggest purchase, the busiest day and the change in net worth", () => {
    const y = getYearInReview(dataset(), 2025, NOW, TZ);
    expect(y.biggestPurchase).toEqual({ name: "SUPERMARKET", amountCents: 30_000, date: "2025-01-10" });
    expect(y.busiestDay).toEqual({ date: "2025-01-10", cents: 30_000 });
    expect(y.netWorth).toEqual({ startCents: 100_000, endCents: 500_000, changeCents: 400_000 });
  });

  it("treats the current year as partial, counting up to today", () => {
    const y = getYearInReview(dataset(), 2026, NOW, TZ);
    expect(y).toMatchObject({ partial: true, spentCents: 8_000, daysCounted: 297, noSpendDays: 296 });
    expect(y.months.find((m) => m.month === "2026-03")?.spentCents).toBe(8_000);
    expect(y.priciestMonth?.month).toBe("2026-03");
    expect(y.cheapestMonth).toBeNull(); // only one month has spending
  });

  it("lists the years that have data, newest first", () => {
    expect(availableYears(dataset(), NOW, TZ)).toEqual([2026, 2025, 2024]);
    expect(availableYears(freshDb(), NOW, TZ)).toEqual([2026]);
  });

  it("refuses years that haven't happened", () => {
    const db = dataset();
    expect(() => getYearInReview(db, 2027, NOW, TZ)).toThrow(YearError);
    expect(() => getYearInReview(db, 1800, NOW, TZ)).toThrow(YearError);
    expect(() => getYearInReview(db, 2025.5, NOW, TZ)).toThrow(YearError);
  });

  it("works for a year with nothing in it", () => {
    const y = getYearInReview(freshDb(), 2025, NOW, TZ);
    expect(y).toMatchObject({
      spentCents: 0,
      incomeCents: 0,
      savingsRate: null,
      topCategories: [],
      biggestPurchase: null,
      busiestDay: null,
      netWorth: null,
      priciestMonth: null,
    });
  });
});
