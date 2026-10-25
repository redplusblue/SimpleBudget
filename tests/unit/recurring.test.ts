import { describe, expect, it } from "vitest";
import { addDaysToDate, zonedDayStart } from "@/lib/finance/dates";
import {
  analyzeSeries,
  detectCadence,
  detectRecurring,
  monthlyCost,
  nextDate,
  upcomingCharges,
} from "@/lib/finance/recurring";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const TODAY = "2026-10-24";
const NOW = at(TODAY);

const series = (dates: string[], dollars: number | number[]) =>
  dates.map((date, i) => ({
    id: i + 1,
    date,
    cents: Math.round((Array.isArray(dollars) ? dollars[i] : dollars) * 100),
    accountId: "A",
    categoryId: null,
  }));
const every = (start: string, step: number, n: number) =>
  Array.from({ length: n }, (_, i) => addDaysToDate(start, i * step));

describe("detectCadence", () => {
  it.each([
    [[7, 7, 8, 6], "weekly"],
    [[14, 14, 13], "biweekly"],
    [[30, 31, 28, 31], "monthly"],
    [[365, 366], "yearly"],
    [[30, 30, 60, 30], "monthly"], // one skipped month is tolerated (3 of 4 fit)
  ])("%j → %s", (intervals, cadence) => {
    expect(detectCadence(intervals)?.cadence).toBe(cadence);
  });

  it.each([[[1, 3, 2, 5]], [[20, 45, 12]], [[30, 60, 60, 90]], [[45]], [[]], [[10, 10]]])("rejects %j", (intervals) => {
    expect(detectCadence(intervals)).toBeNull();
  });
});

describe("nextDate and monthlyCost", () => {
  it("steps by the cadence, clamping to short months and leap years", () => {
    expect(nextDate("2026-10-24", "weekly")).toBe("2026-10-31");
    expect(nextDate("2026-10-24", "biweekly")).toBe("2026-11-07");
    expect(nextDate("2026-10-24", "monthly")).toBe("2026-11-24");
    expect(nextDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDate("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(nextDate("2026-12-15", "monthly")).toBe("2027-01-15");
    expect(nextDate("2025-10-24", "yearly")).toBe("2026-10-24");
    expect(nextDate("2028-02-29", "yearly")).toBe("2029-02-28");
  });
  it("converts every cadence to a monthly cost", () => {
    expect(monthlyCost(1_200, "monthly")).toBe(1_200);
    expect(monthlyCost(1_200, "weekly")).toBe(5_200);
    expect(monthlyCost(1_200, "biweekly")).toBe(2_600);
    expect(monthlyCost(12_000, "yearly")).toBe(1_000);
  });
});

describe("analyzeSeries", () => {
  it("recognizes a steady monthly subscription and predicts the next charge", () => {
    const item = analyzeSeries(
      "netflix",
      "Netflix",
      series(["2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], 15.49),
      TODAY,
    )!;
    expect(item).toMatchObject({
      cadence: "monthly",
      amountCents: 1_549,
      count: 6,
      lastDate: "2026-10-05",
      nextDate: "2026-11-05",
      monthlyCostCents: 1_549,
      active: true,
      increasePct: null,
      previousAmountCents: null,
      overdueDays: 0,
    });
  });

  it("tolerates small amount wobble (±10%)", () => {
    expect(
      analyzeSeries("utility", "Utility", series(every("2026-06-01", 30, 4), [90, 95, 99, 92]), TODAY),
    ).not.toBeNull();
  });

  it("flags a price increase, even a large one on the latest charge", () => {
    const small = analyzeSeries(
      "n",
      "N",
      series(["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], [15.49, 15.49, 15.49, 16.99]),
      TODAY,
    )!;
    expect(small.amountCents).toBe(1_699);
    expect(small.previousAmountCents).toBe(1_549);
    expect(small.increasePct).toBeCloseTo(16.99 / 15.49 - 1);
    const big = analyzeSeries(
      "n",
      "N",
      series(["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], [10, 10, 10, 10, 15]),
      TODAY,
    )!;
    expect(big.increasePct).toBeCloseTo(0.5);
    // a price drop is not an increase
    const drop = analyzeSeries(
      "n",
      "N",
      series(["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"], [10, 10, 10, 10, 8]),
      TODAY,
    )!;
    expect(drop.increasePct).toBeNull();
    expect(drop.previousAmountCents).toBe(1_000);
  });

  it("rejects varying amounts, too few charges and irregular timing", () => {
    expect(analyzeSeries("coffee", "Coffee", series(every("2026-09-01", 7, 5), [4, 9, 6, 12, 5]), TODAY)).toBeNull();
    expect(analyzeSeries("x", "X", series(["2026-08-05", "2026-09-05"], 10), TODAY)).toBeNull();
    expect(
      analyzeSeries("x", "X", series(["2026-08-05", "2026-08-09", "2026-10-02", "2026-10-03"], 10), TODAY),
    ).toBeNull();
    expect(analyzeSeries("x", "X", series(every("2026-06-01", 30, 4), [10, 25, 10, 40]), TODAY)).toBeNull();
  });

  it("recognizes weekly, biweekly and yearly charges", () => {
    expect(analyzeSeries("gym", "Gym", series(every("2026-09-05", 7, 8), 12), TODAY)?.cadence).toBe("weekly");
    expect(analyzeSeries("cleaner", "Cleaner", series(every("2026-07-03", 14, 7), 80), TODAY)?.cadence).toBe(
      "biweekly",
    );
    expect(
      analyzeSeries("domain", "Domain", series(["2024-10-30", "2025-10-30", "2026-10-30"], 20), "2026-10-31")?.cadence,
    ).toBe("yearly");
  });

  it("marks charges that stopped arriving as inactive, after a grace period", () => {
    const charges = series(["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"], 9.99); // next expected 2026-07-05
    expect(analyzeSeries("hulu", "Hulu", charges, "2026-07-10")).toMatchObject({ active: true, overdueDays: 5 });
    expect(analyzeSeries("hulu", "Hulu", charges, "2026-10-24")).toMatchObject({ active: false, overdueDays: 111 });
  });
});

describe("detectRecurring (from the database)", () => {
  function setup() {
    const db = freshDb();
    addAccount(db, "A", { name: "Checking" });
    const spend = (date: string, dollars: number, description: string, over: Parameters<typeof addTxn>[2] = {}) =>
      addTxn(db, "A", { posted: at(date), amountCents: -Math.round(dollars * 100), description, ...over });
    // Netflix: monthly, price rose on the last charge; written differently each time
    ["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].forEach((d, i) =>
      spend(d, 15.49, i % 2 ? "NETFLIX.COM LOS GATOS CA" : "NETFLIX.COM 800-585-5191 CA"),
    );
    spend("2026-10-05", 16.99, "NETFLIX.COM LOS GATOS CA");
    // Spotify: steady monthly
    ["2026-07-09", "2026-08-09", "2026-09-09", "2026-10-09"].forEach((d) => spend(d, 11.99, "SPOTIFY USA"));
    // Gym: weekly
    every("2026-09-05", 7, 8).forEach((d) => spend(d, 12, "PLANET FITNESS #123"));
    // Old subscription that stopped
    ["2026-01-12", "2026-02-12", "2026-03-12"].forEach((d) => spend(d, 7.99, "DROPBOX"));
    // Noise: coffee at random amounts, a pending item, a transfer and an excluded purchase must not count
    ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"].forEach((d, i) =>
      spend(d, [4, 9, 6, 12][i], "BLUE BOTTLE COFFEE"),
    );
    ["2026-07-20", "2026-08-20", "2026-09-20"].forEach((d) => spend(d, 50, "CARD PAYMENT", { isTransfer: true }));
    ["2026-07-21", "2026-08-21", "2026-09-21"].forEach((d) => spend(d, 30, "REIMBURSED GYM", { isExcluded: true }));
    ["2026-07-22", "2026-08-22", "2026-09-22"].forEach((d) =>
      spend(d, 20, "PENDING THING", { pending: true, posted: 0, transactedAt: at(d) }),
    );
    // Income and a one-off
    addTxn(db, "A", { posted: at("2026-10-01"), amountCents: 300_000, description: "ACME PAYROLL" });
    spend("2026-10-12", 200, "AMAZON MKTPLACE");
    return db;
  }

  it("finds the subscriptions with names, cadences, next dates and monthly costs", () => {
    const r = detectRecurring(setup(), NOW, TZ);
    expect(r.items.map((i) => [i.name, i.cadence, i.nextDate])).toEqual(
      [
        ["PLANET FITNESS", "weekly", "2026-10-31"],
        ["SPOTIFY USA", "monthly", "2026-11-09"],
        ["NETFLIX.COM", "monthly", "2026-11-05"],
      ].sort((a, b) => (a[2] < b[2] ? -1 : 1)),
    );
    const netflix = r.items.find((i) => i.name === "NETFLIX.COM")!;
    expect(netflix).toMatchObject({ amountCents: 1_699, previousAmountCents: 1_549, count: 5 });
    expect(netflix.increasePct).toBeCloseTo(0.0968, 3);
    expect(netflix.accountId).toBe("A");
  });

  it("totals the monthly and yearly cost of active charges only", () => {
    const r = detectRecurring(setup(), NOW, TZ);
    const gym = Math.round((1_200 * 52) / 12);
    expect(r.monthlyTotalCents).toBe(1_699 + 1_199 + gym);
    expect(r.yearlyTotalCents).toBe(r.monthlyTotalCents * 12);
  });

  it("reports stopped subscriptions separately", () => {
    const r = detectRecurring(setup(), NOW, TZ);
    expect(r.inactive.map((i) => i.name)).toEqual(["DROPBOX"]);
    expect(r.items.some((i) => i.name === "DROPBOX")).toBe(false);
  });

  it("ignores coffee-style variable spending, pending items, transfers and excluded purchases", () => {
    const names = detectRecurring(setup(), NOW, TZ).items.map((i) => i.name);
    for (const bad of [
      "BLUE BOTTLE COFFEE",
      "CARD PAYMENT",
      "REIMBURSED GYM",
      "PENDING THING",
      "AMAZON MKTPLACE",
      "ACME PAYROLL",
    ])
      expect(names).not.toContain(bad);
  });

  it("returns nothing for an empty database", () => {
    expect(detectRecurring(freshDb(), NOW, TZ)).toEqual({
      items: [],
      inactive: [],
      monthlyTotalCents: 0,
      yearlyTotalCents: 0,
    });
  });

  it("lists upcoming charges within a horizon, soonest first, with days away", () => {
    const report = detectRecurring(setup(), NOW, TZ);
    const soon = upcomingCharges(report, TODAY, 10);
    expect(soon.map((u) => [u.name, u.inDays])).toEqual([["PLANET FITNESS", 7]]);
    expect(upcomingCharges(report, TODAY, 30).map((u) => u.name)).toEqual([
      "PLANET FITNESS",
      "NETFLIX.COM",
      "SPOTIFY USA",
    ]);
    expect(upcomingCharges(report, TODAY, 30, 2)).toHaveLength(2);
  });

  it("keeps a slightly late charge visible as due (negative days away)", () => {
    const db = freshDb();
    addAccount(db, "A");
    ["2026-07-20", "2026-08-20", "2026-09-20"].forEach((d) =>
      addTxn(db, "A", { posted: at(d), amountCents: -999, description: "LATE PAYER" }),
    );
    const u = upcomingCharges(detectRecurring(db, NOW, TZ), TODAY, 30);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ nextDate: "2026-10-20", inDays: -4, overdueDays: 4, active: true });
  });
});
