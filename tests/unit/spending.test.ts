import { describe, expect, it } from "vitest";
import { accounts } from "@/db/schema";
import { getDashboard } from "@/lib/finance/dashboard";
import { createTarget } from "@/lib/finance/targets";
import { zonedDayStart } from "@/lib/finance/dates";
import { getCategoryBreakdown, getMonthlySpending } from "@/lib/finance/spending";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

/**
 * A small dataset whose totals are worked out by hand (amounts in dollars × 100):
 *   Oct (current, day 24): spent 100+250+50+75+20(pending) = 495, income 3000
 *        ignored: -500 transfer, -40 excluded
 *   Sep (30 days): 200 (d1) + 300 (d10) + 60 (d24) + 140 (d25) + 90 (d30) = 790; 560 by day 24
 *   Aug: 400    Jul: 100 + 200 (d31) = 300    Jun: nothing
 */
function dataset() {
  const db = freshDb();
  addAccount(db, "a");
  const groceries = categoryId(db, "Groceries");
  const dining = categoryId(db, "Dining");
  const income = categoryId(db, "Income");
  const spend = (date: string, dollars: number, extra: Parameters<typeof addTxn>[2] = {}) =>
    addTxn(db, "a", { posted: at(date), amountCents: -dollars * 100, ...extra });

  spend("2026-10-01", 100);
  spend("2026-10-03", 250, { categoryId: groceries });
  spend("2026-10-10", 50, { categoryId: dining });
  spend("2026-10-24", 75, { categoryId: dining });
  spend("2026-10-23", 20, { pending: true, posted: 0, transactedAt: at("2026-10-23") });
  spend("2026-10-06", 500, { isTransfer: true });
  spend("2026-10-07", 40, { isExcluded: true });
  addTxn(db, "a", { posted: at("2026-10-05"), amountCents: 300_000, categoryId: income });
  addTxn(db, "a", { posted: at("2026-10-08"), amountCents: 10_000, isTransfer: true }); // not income

  spend("2026-09-01", 200);
  spend("2026-09-10", 300, { categoryId: groceries });
  spend("2026-09-24", 60, { categoryId: dining });
  spend("2026-09-25", 140);
  spend("2026-09-30", 90);
  spend("2026-08-05", 400);
  spend("2026-07-05", 100);
  spend("2026-07-31", 200);
  return db;
}

describe("getMonthlySpending", () => {
  it("totals spent, income and net for the month using the expense/income definitions", () => {
    const { glance } = getMonthlySpending(dataset(), "2026-10", NOW, TZ);
    expect(glance).toMatchObject({
      month: "2026-10",
      isCurrent: true,
      spentCents: 49_500,
      incomeCents: 300_000,
      netCents: 300_000 - 49_500,
    });
  });

  it("compares with last month at the same point (to-date), not the full month", () => {
    const { glance } = getMonthlySpending(dataset(), "2026-10", NOW, TZ);
    expect(glance.pace).toEqual({ dayOfMonth: 24, lastMonthToDateCents: 56_000, deltaCents: 49_500 - 56_000 });
  });

  it("builds cumulative series for this month, last month and the 3-month average", () => {
    const { chart } = getMonthlySpending(dataset(), "2026-10", NOW, TZ);
    expect(chart.points).toHaveLength(31);
    const p = (day: number) => chart.points[day - 1];
    expect(p(1)).toMatchObject({ current: 10_000, last: 20_000 });
    expect(p(3).current).toBe(35_000);
    expect(p(24).current).toBe(49_500); // includes today and the pending item
    expect(p(25).current).toBeNull(); // future days are blank
    expect(p(24).last).toBe(56_000);
    expect(p(30).last).toBe(79_000);
    expect(p(31).last).toBeNull(); // September has 30 days
    // average of Sep (560), Aug (400), Jul (100) at day 24 → 353.33; at day 31 Sep carries 790 → 496.67
    expect(p(24).average).toBe(35_333);
    expect(p(31).average).toBe(49_667);
    expect(chart.hasComparison).toBe(true);
  });

  it("handles a past month: full-month totals, no pace, no blank future", () => {
    const { glance, chart } = getMonthlySpending(dataset(), "2026-09", NOW, TZ);
    expect(glance).toMatchObject({ isCurrent: false, spentCents: 79_000, pace: null });
    expect(chart.points).toHaveLength(30);
    expect(chart.points[29].current).toBe(79_000);
  });

  it("reports no comparison when there is no history", () => {
    const db = freshDb();
    addAccount(db, "a");
    addTxn(db, "a", { posted: at("2026-10-02"), amountCents: -500 });
    const { chart, glance } = getMonthlySpending(db, "2026-10", NOW, TZ);
    expect(chart.hasComparison).toBe(false);
    expect(chart.points.every((p) => p.average === null)).toBe(true);
    expect(glance.pace).toMatchObject({ lastMonthToDateCents: 0, deltaCents: 500 });
  });

  it("uses the user's timezone to decide which day a purchase belongs to", () => {
    const db = freshDb();
    addAccount(db, "a");
    // 2026-10-24T02:00Z is still October 23rd in New York.
    addTxn(db, "a", { posted: zonedDayStart("2026-10-24", "UTC") + 2 * 3600, amountCents: -1000 });
    const ny = getMonthlySpending(db, "2026-10", NOW, "America/New_York");
    expect(ny.chart.points[22].current).toBe(1000);
    expect(ny.chart.points[21].current).toBe(0);
    const utc = getMonthlySpending(db, "2026-10", NOW, "UTC");
    expect(utc.chart.points[22].current).toBe(0);
    expect(utc.chart.points[23].current).toBe(1000);
  });

  it("handles a short month following a long one (leap years too)", () => {
    const db = freshDb();
    addAccount(db, "a");
    addTxn(db, "a", { posted: at("2028-01-10"), amountCents: -1000 });
    addTxn(db, "a", { posted: at("2028-01-31"), amountCents: -500 });
    addTxn(db, "a", { posted: at("2028-02-29"), amountCents: -300 });
    const { chart } = getMonthlySpending(db, "2028-02", at("2028-03-05"), TZ);
    expect(chart.points).toHaveLength(29);
    expect(chart.points[28].current).toBe(300);
    expect(chart.points[28].last).toBe(1000); // January's days 30-31 fall outside February's chart
  });
});

describe("getCategoryBreakdown", () => {
  it("ranks categories with shares and change vs last month", () => {
    const b = getCategoryBreakdown(dataset(), "2026-10", TZ);
    expect(b.totalCents).toBe(49_500);
    expect(b.items.map((i) => [i.name, i.cents])).toEqual([
      ["Groceries", 25_000],
      ["Dining", 12_500],
      ["Uncategorized", 12_000],
    ]);
    expect(b.items[0]).toMatchObject({ previousCents: 30_000, deltaCents: -5_000 });
    expect(b.items[1]).toMatchObject({ previousCents: 6_000, deltaCents: 6_500 });
    expect(b.items[2]).toMatchObject({ id: null, previousCents: 43_000, deltaCents: -31_000 });
    expect(b.items.reduce((s, i) => s + i.share, 0)).toBeCloseTo(1);
    expect(b.otherCents).toBe(0);
  });

  it("folds categories beyond the top N into 'other' so slices add up", () => {
    const db = freshDb();
    addAccount(db, "a");
    for (const [i, name] of ["Groceries", "Dining", "Transport", "Shopping"].entries()) {
      addTxn(db, "a", { posted: at("2026-10-02"), amountCents: -(i + 1) * 1000, categoryId: categoryId(db, name) });
    }
    const b = getCategoryBreakdown(db, "2026-10", TZ, 2);
    expect(b.items.map((i) => i.name)).toEqual(["Shopping", "Transport"]);
    expect(b.otherCents).toBe(3000);
    expect(b.items.reduce((s, i) => s + i.cents, 0) + b.otherCents).toBe(b.totalCents);
  });

  it("is empty for a month without spending", () => {
    expect(getCategoryBreakdown(dataset(), "2026-06", TZ)).toEqual({ totalCents: 0, items: [], otherCents: 0 });
  });
});

describe("getDashboard", () => {
  it("bundles everything and reflects 'no accounts' on a fresh install", () => {
    const empty = getDashboard(freshDb(), { now: NOW, timeZone: TZ });
    expect(empty).toMatchObject({ hasAccounts: false, recent: [], accounts: [] });
    expect(empty.netWorth).toMatchObject({ totalCents: 0, series: [] });
    expect(empty.glance).toMatchObject({ spentCents: 0, incomeCents: 0 });
  });

  it("returns the 8 most recent transactions and the month it was asked for", () => {
    const db = dataset();
    db.update(accounts).set({ balanceCents: 123_456 }).run();
    const d = getDashboard(db, { now: NOW, timeZone: TZ });
    expect(d.month).toBe("2026-10");
    expect(d.hasAccounts).toBe(true);
    expect(d.recent).toHaveLength(8);
    expect(d.recent[0].pending).toBe(true); // pending first
    expect(d.netWorth.totalCents).toBe(123_456);
    expect(getDashboard(db, { month: "2026-09", now: NOW, timeZone: TZ }).glance.spentCents).toBe(79_000);
  });

  it("includes target progress, and nothing at all when no targets exist", () => {
    const db = dataset().db;
    expect(getDashboard(db, { now: NOW, timeZone: TZ }).targets).toEqual([]);
    createTarget(db, { kind: "category", subjectId: categoryId(db, "Groceries"), amountCents: 20_000 });
    const d = getDashboard(db, { now: NOW, timeZone: TZ });
    expect(d.targets).toHaveLength(1);
    expect(d.targets[0]).toMatchObject({ name: "Groceries", spentCents: 15_000, status: "ok" });
    // past months are measured too, without a projection
    expect(getDashboard(db, { month: "2026-09", now: NOW, timeZone: TZ }).targets[0]).toMatchObject({
      spentCents: 8_000,
      projectedCents: null,
    });
  });

  it("includes upcoming recurring charges and their monthly total", () => {
    const db = freshDb();
    addAccount(db, "a");
    ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].forEach((d) =>
      addTxn(db, "a", { posted: at(d), amountCents: -1_549, description: "NETFLIX.COM LOS GATOS CA" }),
    );
    ["2026-07-30", "2026-08-30", "2026-09-30"].forEach((d) =>
      addTxn(db, "a", { posted: at(d), amountCents: -999, description: "CLOUD STORAGE" }),
    );
    const d = getDashboard(db, { now: NOW, timeZone: TZ });
    expect(d.upcoming.activeCount).toBe(2);
    expect(d.upcoming.monthlyTotalCents).toBe(1_549 + 999);
    expect(d.upcoming.items.map((u) => [u.name, u.nextDate, u.inDays])).toEqual(
      [
        ["NETFLIX.COM", "2026-11-05", 12],
        ["CLOUD STORAGE", "2026-10-30", 6],
      ].sort((a, b) => (a[1] as string).localeCompare(b[1] as string)),
    );
    expect(getDashboard(freshDb(), { now: NOW, timeZone: TZ }).upcoming).toEqual({
      items: [],
      monthlyTotalCents: 0,
      activeCount: 0,
    });
  });

  it("answers in well under 300 ms with 10,000 transactions", () => {
    const db = freshDb();
    addAccount(db, "a", { balanceCents: 1_000_000 });
    const cats = ["Groceries", "Dining", "Transport", "Shopping", "Health"].map((n) => categoryId(db, n));
    db.transaction((tx) => {
      for (let i = 0; i < 10_000; i++) {
        addTxn(tx as never, "a", {
          posted: NOW - Math.floor((i / 10_000) * 730) * 86_400 - (i % 86_400),
          amountCents: i % 25 === 0 ? 400_000 : -((i % 400) + 100),
          categoryId: cats[i % cats.length],
        });
      }
    });
    getDashboard(db, { now: NOW, timeZone: TZ }); // warm statement/formatter caches
    const t0 = performance.now();
    const d = getDashboard(db, { now: NOW, timeZone: TZ });
    const ms = performance.now() - t0;
    expect(d.categories.totalCents).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  }, 30_000);
});
