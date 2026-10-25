import { describe, expect, it } from "vitest";
import { zonedDayStart } from "@/lib/finance/dates";
import { createTarget } from "@/lib/finance/targets";
import { getSpendingReport, MAX_CUSTOM_DAYS, ReportError, resolveRange } from "@/lib/finance/spending-report";
import { transactionTags } from "@/db/schema";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24"); // a Saturday

/**
 * Hand-computed dataset (dollars; "A" = checking, "B" = card). October, as of the 24th:
 *   Oct 1 Thu  A  100  TRADER JOE'S #1 AUSTIN TX   Groceries
 *   Oct 3 Sat  B   50  TRADER JOES #2              Groceries
 *   Oct 5 Mon  A   30  SQ *BLUE BOTTLE COFFEE      Dining   (tag work)
 *   Oct 5 Mon  B   20  SQ *BLUE BOTTLE COFFEE      Dining   (tag work)
 *   Oct 10 Sat A  200  AMAZON MKTPLACE             (uncategorized)
 *   Oct 24 Sat B   40  SHELL OIL 57444             Transport
 *   income Oct 15 +3000; ignored: a -500 transfer and a -60 excluded purchase
 *   => spent 440 over 6 purchases, income 3000
 * September: 80 groceries (d2) + 120 uncategorized (d20) + 60 dining (d25) = 260, income 2500.
 * August: 30 groceries. July: 90 groceries + 10 dining. June: nothing.
 */
function dataset() {
  const db = freshDb();
  addAccount(db, "A", { name: "Checking" });
  addAccount(db, "B", { name: "Card", displayName: "Sapphire", color: "#F472B6" });
  const [groceries, dining, transport, income] = ["Groceries", "Dining", "Transport", "Income"].map((n) =>
    categoryId(db, n),
  );
  const work = addTag(db, "work");
  const spend = (date: string, dollars: number, account: string, description: string, category?: number) =>
    addTxn(db, account, { posted: at(date), amountCents: -dollars * 100, description, categoryId: category });

  spend("2026-10-01", 100, "A", "TRADER JOE'S #1 AUSTIN TX", groceries);
  spend("2026-10-03", 50, "B", "TRADER JOES #2", groceries);
  const c1 = spend("2026-10-05", 30, "A", "SQ *BLUE BOTTLE COFFEE", dining);
  const c2 = spend("2026-10-05", 20, "B", "SQ *BLUE BOTTLE COFFEE", dining);
  db.insert(transactionTags)
    .values([
      { transactionId: c1.id, tagId: work.id },
      { transactionId: c2.id, tagId: work.id },
    ])
    .run();
  spend("2026-10-10", 200, "A", "AMAZON MKTPLACE");
  spend("2026-10-24", 40, "B", "SHELL OIL 57444", transport);
  addTxn(db, "A", { posted: at("2026-10-15"), amountCents: 300_000, categoryId: income, description: "ACME PAYROLL" });
  addTxn(db, "A", { posted: at("2026-10-06"), amountCents: -50_000, isTransfer: true, description: "CARD PAYMENT" });
  addTxn(db, "A", { posted: at("2026-10-07"), amountCents: -6_000, isExcluded: true, description: "REIMBURSED" });

  spend("2026-09-02", 80, "A", "TRADER JOE'S #1", groceries);
  spend("2026-09-20", 120, "B", "AMAZON MKTPLACE");
  spend("2026-09-25", 60, "A", "SQ *BLUE BOTTLE COFFEE", dining);
  addTxn(db, "A", { posted: at("2026-09-15"), amountCents: 250_000, categoryId: income, description: "ACME PAYROLL" });
  spend("2026-08-10", 30, "A", "TRADER JOE'S #1", groceries);
  spend("2026-07-03", 90, "A", "TRADER JOE'S #1", groceries);
  spend("2026-07-04", 10, "A", "SQ *BLUE BOTTLE COFFEE", dining);
  return { db, ids: { groceries, dining, transport } };
}

const report = (
  db: ReturnType<typeof freshDb>,
  input: Parameters<typeof getSpendingReport>[1] = { month: "2026-10" },
  tz = TZ,
) => getSpendingReport(db, input, NOW, tz);

describe("summary", () => {
  it("totals spent, income, net, savings rate, purchases, per-day average and the largest purchase", () => {
    const { summary, range } = report(dataset().db);
    expect(range).toMatchObject({
      kind: "month",
      from: "2026-10-01",
      to: "2026-10-31",
      days: 31,
      elapsedDays: 24,
      isCurrent: true,
      label: "October 2026",
    });
    expect(summary).toMatchObject({ spentCents: 44_000, incomeCents: 300_000, netCents: 256_000, purchaseCount: 6 });
    expect(summary.savingsRate).toBeCloseTo(256_000 / 300_000);
    expect(summary.avgPerDayCents).toBe(Math.round(44_000 / 24)); // spread over the days that have happened
    expect(summary.largest).toMatchObject({ name: "AMAZON MKTPLACE", amountCents: 20_000, date: "2026-10-10" });
  });

  it("includes the comparison period's totals", () => {
    const { summary, range } = report(dataset().db);
    expect(summary).toMatchObject({ previousSpentCents: 26_000, previousIncomeCents: 250_000 });
    expect(range.previous).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "September 2026" });
  });

  it("handles an empty month: zeros, no savings rate, no largest purchase", () => {
    const { summary } = report(dataset().db, { month: "2026-06" });
    expect(summary).toMatchObject({
      spentCents: 0,
      incomeCents: 0,
      netCents: 0,
      savingsRate: null,
      purchaseCount: 0,
      avgPerDayCents: 0,
      largest: null,
    });
  });

  it("uses the whole month for a past month and nothing for a future one", () => {
    const { db } = dataset();
    expect(report(db, { month: "2026-09" }).summary).toMatchObject({
      spentCents: 26_000,
      avgPerDayCents: Math.round(26_000 / 30),
    });
    const future = report(db, { month: "2027-01" });
    expect(future.range).toMatchObject({ elapsedDays: 0, isCurrent: false });
    expect(future.summary.avgPerDayCents).toBe(0);
  });
});

describe("targets in the report", () => {
  it("are empty without targets, present for a month, and absent for custom ranges", () => {
    const { db, ids } = dataset();
    expect(report(db).targets).toEqual([]);
    createTarget(db, { kind: "category", subjectId: ids.dining, amountCents: 4_000 });
    const month = report(db);
    expect(month.targets).toHaveLength(1);
    expect(month.targets[0]).toMatchObject({ name: "Dining", spentCents: 5_000, status: "over" });
    expect(report(db, { from: "2026-10-01", to: "2026-10-31" }).targets).toEqual([]);
  });
});

describe("category comparison", () => {
  it("compares with last month and the 3-month average, largest change first", () => {
    const { comparison } = report(dataset().db);
    const by = Object.fromEntries(comparison.map((c) => [c.name, c]));
    expect(by.Groceries).toMatchObject({
      cents: 15_000,
      previousCents: 8_000,
      deltaPreviousCents: 7_000,
      averageCents: Math.round((8_000 + 3_000 + 9_000) / 3),
      deltaAverageCents: 15_000 - 6_667,
    });
    expect(by.Dining).toMatchObject({
      cents: 5_000,
      previousCents: 6_000,
      deltaPreviousCents: -1_000,
      averageCents: Math.round((6_000 + 0 + 1_000) / 3),
    });
    expect(by.Transport).toMatchObject({ cents: 4_000, previousCents: 0, deltaPreviousCents: 4_000, averageCents: 0 });
    expect(by.Uncategorized).toMatchObject({
      id: null,
      cents: 20_000,
      previousCents: 12_000,
      deltaPreviousCents: 8_000,
      averageCents: 4_000,
    });
    expect(comparison.map((c) => c.name)).toEqual(["Uncategorized", "Groceries", "Transport", "Dining"]);
  });

  it("includes categories that only had spending before (they went to zero)", () => {
    const { comparison } = report(dataset().db, { month: "2026-09" });
    const aug = comparison.find((c) => c.name === "Groceries")!;
    expect(aug).toMatchObject({ cents: 8_000, previousCents: 3_000 });
    const nov = report(dataset().db, { month: "2026-11" }).comparison;
    expect(nov.map((c) => [c.name, c.cents, c.previousCents])).toEqual(
      expect.arrayContaining([["Groceries", 0, 15_000]]),
    );
  });
});

describe("breakdowns", () => {
  it("by category with shares, counts and a 6 month trend", () => {
    const { categories } = report(dataset().db);
    expect(categories.map((c) => [c.name, c.cents, c.count])).toEqual([
      ["Uncategorized", 20_000, 1],
      ["Groceries", 15_000, 2],
      ["Dining", 5_000, 2],
      ["Transport", 4_000, 1],
    ]);
    expect(categories[0].share).toBeCloseTo(20_000 / 44_000);
    expect(categories.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
    // May..Oct for Groceries: nothing, nothing, 90 (Jul), 30 (Aug), 80 (Sep), 150 (Oct)
    expect(categories.find((c) => c.name === "Groceries")!.trend).toEqual([0, 0, 9_000, 3_000, 8_000, 15_000]);
  });

  it("by tag (overlap allowed)", () => {
    expect(report(dataset().db).tags).toEqual([expect.objectContaining({ name: "work", cents: 5_000, count: 2 })]);
  });

  it("by merchant uses the cleaned-up name, with counts and average ticket", () => {
    const { merchants } = report(dataset().db);
    expect(merchants.map((m) => [m.name, m.key, m.cents, m.count, m.avgCents])).toEqual([
      ["AMAZON MKTPLACE", "amazonmktplace", 20_000, 1, 20_000],
      ["TRADER JOES", "traderjoes", 15_000, 2, 7_500], // "TRADER JOE'S #1" and "TRADER JOES #2" are one merchant
      ["BLUE BOTTLE COFFEE", "bluebottlecoffee", 5_000, 2, 2_500],
      ["SHELL OIL", "shelloil", 4_000, 1, 4_000],
    ]);
  });

  it("limits merchants to the top 15", () => {
    const db = freshDb();
    addAccount(db, "A");
    for (let i = 0; i < 20; i++)
      addTxn(db, "A", {
        posted: at("2026-10-02"),
        amountCents: -(i + 1) * 100,
        description: `SHOP ${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)}`,
      });
    const { merchants } = report(db);
    expect(merchants).toHaveLength(15);
    expect(merchants[0].cents).toBe(2_000);
  });

  it("by account uses display names and colors", () => {
    const { accounts } = report(dataset().db);
    expect(accounts.map((a) => [a.id, a.name, a.color, a.cents, a.count])).toEqual([
      ["A", "Checking", null, 33_000, 3],
      ["B", "Sapphire", "#F472B6", 11_000, 3],
    ]);
    expect(accounts[0].share).toBeCloseTo(0.75);
  });
});

describe("daily and weekday patterns", () => {
  it("lists every day of the range, flagging days that haven't happened", () => {
    const { daily } = report(dataset().db);
    expect(daily).toHaveLength(31);
    expect(daily.filter((d) => d.cents > 0).map((d) => [d.date, d.cents])).toEqual([
      ["2026-10-01", 10_000],
      ["2026-10-03", 5_000],
      ["2026-10-05", 5_000],
      ["2026-10-10", 20_000],
      ["2026-10-24", 4_000],
    ]);
    expect(daily[23].future).toBe(false);
    expect(daily[24].future).toBe(true);
    expect(daily.reduce((s, d) => s + d.cents, 0)).toBe(44_000);
  });

  it("averages per weekday over the days that have happened", () => {
    const { weekdays } = report(dataset().db);
    const by = (dow: number) => weekdays[dow];
    expect(by(4)).toMatchObject({ cents: 10_000, occurrences: 4, avgCents: 2_500 }); // Thursdays: 1, 8, 15, 22
    expect(by(6)).toMatchObject({ cents: 29_000, occurrences: 4, avgCents: 7_250 }); // Saturdays: 3, 10, 17, 24
    expect(by(1)).toMatchObject({ cents: 5_000, occurrences: 3, avgCents: Math.round(5_000 / 3) }); // Mondays: 5, 12, 19
    expect(by(0)).toMatchObject({ cents: 0, occurrences: 3 }); // Sundays 4, 11, 18
    expect(weekdays.reduce((s, w) => s + w.cents, 0)).toBe(44_000);
  });
});

describe("12 month trends", () => {
  it("stacks the top categories with the rest folded together, plus monthly income", () => {
    const { trends } = report(dataset().db);
    expect(trends.months).toHaveLength(12);
    expect(trends.months[0]).toBe("2025-11");
    expect(trends.months[11]).toBe("2026-10");
    const groceries = trends.series.find((s) => s.name === "Groceries")!;
    expect(groceries.values.slice(-4)).toEqual([9_000, 3_000, 8_000, 15_000]);
    expect(trends.incomeCents.slice(-2)).toEqual([250_000, 300_000]);
    // every month's stack adds up to that month's total spending
    const stack = (i: number) => trends.series.reduce((s, x) => s + x.values[i], 0);
    expect([stack(11), stack(10), stack(9), stack(8)]).toEqual([44_000, 26_000, 3_000, 10_000]);
  });

  it("folds categories beyond the top five into 'Everything else'", () => {
    const db = freshDb();
    addAccount(db, "A");
    ["Groceries", "Dining", "Transport", "Shopping", "Health", "Travel", "Gifts"].forEach((n, i) =>
      addTxn(db, "A", { posted: at("2026-10-03"), amountCents: -(i + 1) * 1_000, categoryId: categoryId(db, n) }),
    );
    const { trends } = report(db);
    expect(trends.series).toHaveLength(6);
    expect(trends.series[5]).toMatchObject({ name: "Everything else", id: null, other: true });
    expect(trends.series[5].values[11]).toBe(1_000 + 2_000); // the two smallest
  });

  it("shows the whole last month for a custom range that ends mid-month", () => {
    const { trends } = report(dataset().db, { from: "2026-10-01", to: "2026-10-05" });
    expect(trends.series.reduce((s, x) => s + x.values[11], 0)).toBe(44_000);
  });
});

describe("custom ranges", () => {
  it("totals only the range and compares with the equally long period before it", () => {
    const { db } = dataset();
    const r = report(db, { from: "2026-10-01", to: "2026-10-10" });
    expect(r.range).toMatchObject({
      kind: "custom",
      days: 10,
      elapsedDays: 10,
      previous: { from: "2026-09-21", to: "2026-09-30" },
    });
    expect(r.summary).toMatchObject({
      spentCents: 40_000,
      purchaseCount: 5,
      incomeCents: 0,
      previousSpentCents: 6_000,
    }); // Sep 25 dining only
    expect(r.comparison.every((c) => c.averageCents === null && c.deltaAverageCents === null)).toBe(true);
    expect(r.daily).toHaveLength(10);
  });

  it("works across months, and for a single day", () => {
    const { db } = dataset();
    expect(report(db, { from: "2026-09-25", to: "2026-10-03" }).summary.spentCents).toBe(6_000 + 10_000 + 5_000);
    const one = report(db, { from: "2026-10-10", to: "2026-10-10" });
    expect(one.summary).toMatchObject({ spentCents: 20_000, purchaseCount: 1 });
    expect(one.range.label).toBe("Oct 10, 2026");
  });

  it("caps elapsed days at today for ranges reaching into the future", () => {
    const r = report(dataset().db, { from: "2026-10-20", to: "2026-11-10" });
    expect(r.range).toMatchObject({ days: 22, elapsedDays: 5, isCurrent: true });
  });

  it.each([
    [{ from: "2026-10-10", to: "2026-10-01" }, /on or before/],
    [{ from: "2026-02-30", to: "2026-03-01" }, /Dates must/],
    [{ from: "nope", to: "2026-03-01" }, /Dates must/],
    [{ from: "2025-01-01", to: "2026-10-01" }, new RegExp(`${MAX_CUSTOM_DAYS} days`)],
    [{ month: "2026-13" }, /month must/],
    [{ month: "October" }, /month must/],
  ])("rejects %j", (input, message) => {
    expect(() => resolveRange(input as never, NOW, TZ)).toThrow(ReportError);
    expect(() => resolveRange(input as never, NOW, TZ)).toThrow(message);
  });

  it("accepts exactly 366 days", () => {
    expect(resolveRange({ from: "2025-10-24", to: "2026-10-24" }, NOW, TZ).days).toBe(366);
  });
});

describe("timezones", () => {
  it("buckets purchases into the user's local days and months", () => {
    const db = freshDb();
    addAccount(db, "A");
    // 2026-11-01T02:00Z is still October 31st in New York.
    addTxn(db, "A", {
      posted: zonedDayStart("2026-11-01", "UTC") + 2 * 3600,
      amountCents: -1_000,
      description: "LATE NIGHT",
    });
    const now = zonedDayStart("2026-11-15", "UTC");
    expect(getSpendingReport(db, { month: "2026-10" }, now, "America/New_York").summary.spentCents).toBe(1_000);
    expect(getSpendingReport(db, { month: "2026-11" }, now, "America/New_York").summary.spentCents).toBe(0);
    expect(getSpendingReport(db, { month: "2026-11" }, now, "UTC").summary.spentCents).toBe(1_000);
    const ny = getSpendingReport(db, { month: "2026-10" }, now, "America/New_York");
    expect(ny.daily[30]).toMatchObject({ date: "2026-10-31", cents: 1_000 });
  });
});

describe("performance", () => {
  it("builds the full report from 10,000 transactions in well under 300 ms", () => {
    const db = freshDb();
    addAccount(db, "A");
    const cats = ["Groceries", "Dining", "Transport", "Shopping", "Health"].map((n) => categoryId(db, n));
    db.transaction((tx) => {
      for (let i = 0; i < 10_000; i++) {
        addTxn(tx as never, "A", {
          posted: NOW - Math.floor((i / 10_000) * 730) * 86_400 - (i % 80_000),
          amountCents: -((i % 400) + 100),
          categoryId: cats[i % 5],
          description: `MERCHANT ${i % 60} #${i}`,
        });
      }
    });
    report(db); // warm caches
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const r = report(db);
      best = Math.min(best, performance.now() - t0);
      expect(r.summary.spentCents).toBeGreaterThan(0);
    }
    expect(best).toBeLessThan(300);
  }, 30_000);
});
