import { describe, expect, it } from "vitest";
import { accounts, balanceSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { zonedDayStart } from "@/lib/finance/dates";
import { getNetWorthSeries, getNetWorthSummary, netWorthBetween } from "@/lib/finance/networth";
import { addAccount, freshDb } from "../helpers/db";

const TZ = "UTC";
const NOW = zonedDayStart("2026-10-24", TZ) + 12 * 3600;

const snap = (db: ReturnType<typeof freshDb>, id: string, date: string, balanceCents: number) =>
  db.insert(balanceSnapshots).values({ accountId: id, date, balanceCents }).run();

function setup() {
  const db = freshDb();
  addAccount(db, "chk", { balanceCents: 1000 });
  addAccount(db, "cc", { type: "credit", balanceCents: -300 });
  return db;
}

describe("netWorthBetween", () => {
  it("sums accounts and carries balances forward over gaps", () => {
    const db = setup();
    snap(db, "chk", "2026-10-20", 500);
    snap(db, "cc", "2026-10-20", -100);
    snap(db, "chk", "2026-10-23", 900);
    const s = netWorthBetween(db, ["chk", "cc"], "2026-10-20", "2026-10-24");
    expect(s).toEqual([
      { date: "2026-10-20", balanceCents: 400 },
      { date: "2026-10-21", balanceCents: 400 },
      { date: "2026-10-22", balanceCents: 400 },
      { date: "2026-10-23", balanceCents: 800 },
      { date: "2026-10-24", balanceCents: 800 },
    ]);
  });

  it("treats days before an account's first snapshot as absent, not zero", () => {
    const db = setup();
    snap(db, "chk", "2026-10-01", 1000);
    snap(db, "cc", "2026-10-10", -400); // added mid-history
    const s = netWorthBetween(db, ["chk", "cc"], "2026-10-08", "2026-10-12");
    expect(s.map((p) => p.balanceCents)).toEqual([1000, 1000, 600, 600, 600]);
    expect(Math.min(...s.map((p) => p.balanceCents))).toBeGreaterThan(0); // never a dip to zero
  });

  it("starts from balances recorded before the window", () => {
    const db = setup();
    snap(db, "chk", "2026-01-01", 700);
    expect(netWorthBetween(db, ["chk"], "2026-10-23", "2026-10-24").map((p) => p.balanceCents)).toEqual([700, 700]);
  });

  it("omits days with no data at all and handles no accounts", () => {
    const db = setup();
    snap(db, "chk", "2026-10-22", 5);
    expect(netWorthBetween(db, ["chk"], "2026-10-20", "2026-10-23").map((p) => p.date)).toEqual([
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(netWorthBetween(db, [], "2026-10-20", "2026-10-23")).toEqual([]);
  });
});

describe("getNetWorthSeries", () => {
  it("honors ranges and replaces today's point with live balances", () => {
    const db = setup();
    for (let d = 1; d <= 24; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      snap(db, "chk", date, 100 * d);
      snap(db, "cc", date, -50);
    }
    const month = getNetWorthSeries(db, "1M", NOW, TZ);
    expect(month).toHaveLength(24); // only 24 days of data exist
    expect(month[0].date).toBe("2026-10-01");
    // today uses the live balances (1000 + -300), not the snapshot (2400 - 50)
    expect(month[month.length - 1]).toEqual({ date: "2026-10-24", balanceCents: 700 });
    expect(getNetWorthSeries(db, "ALL", NOW, TZ)[0].date).toBe("2026-10-01");
    expect(getNetWorthSeries(db, "1Y", NOW, TZ)).toHaveLength(24);
  });

  it("appends today when the last snapshot is older", () => {
    const db = setup();
    snap(db, "chk", "2026-10-20", 50);
    snap(db, "cc", "2026-10-20", -10);
    const s = getNetWorthSeries(db, "1M", NOW, TZ);
    expect(s[s.length - 1]).toEqual({ date: "2026-10-24", balanceCents: 700 });
    expect(s.find((p) => p.date === "2026-10-23")).toEqual({ date: "2026-10-23", balanceCents: 40 });
  });

  it("returns nothing without accounts", () => {
    expect(getNetWorthSeries(freshDb(), "3M", NOW, TZ)).toEqual([]);
  });
});

describe("getNetWorthSummary", () => {
  it("splits assets and liabilities and counts only included accounts", () => {
    const db = setup();
    addAccount(db, "hidden", { balanceCents: 99_999, isHidden: true });
    addAccount(db, "excl", { balanceCents: 88_888, excludeFromNetWorth: true });
    addAccount(db, "loan", { type: "loan", balanceCents: -5_000 });
    const s = getNetWorthSummary(db, "3M", NOW, TZ);
    expect(s).toMatchObject({
      totalCents: 1000 - 300 - 5000,
      assetsCents: 1000,
      liabilitiesCents: 5300,
      accountCount: 3,
    });
  });

  it("measures the change against exactly 30 days ago when history allows", () => {
    const db = setup();
    snap(db, "chk", "2026-09-01", 400);
    snap(db, "cc", "2026-09-01", 0);
    snap(db, "chk", "2026-09-24", 500);
    const s = getNetWorthSummary(db, "1M", NOW, TZ);
    expect(s.baselineDate).toBe("2026-09-24");
    expect(s.baselineKind).toBe("30d");
    expect(s.changeCents).toBe(700 - 500);
    expect(s.changePct).toBeCloseTo(0.4);
  });

  it("falls back to the first day with data when history is shorter than 30 days", () => {
    const db = setup();
    snap(db, "chk", "2026-10-14", 500);
    const s = getNetWorthSummary(db, "1M", NOW, TZ);
    expect(s).toMatchObject({ baselineDate: "2026-10-14", baselineKind: "first", changeCents: 200 });
  });

  it("has no change with a single day of history or a zero baseline", () => {
    const db = setup();
    expect(getNetWorthSummary(db, "1M", NOW, TZ)).toMatchObject({
      changeCents: null,
      changePct: null,
      baselineKind: null,
    });
    snap(db, "chk", "2026-10-20", 0);
    snap(db, "cc", "2026-10-20", 0);
    expect(getNetWorthSummary(db, "1M", NOW, TZ)).toMatchObject({ changeCents: 700, changePct: null });
  });

  it("uses the absolute baseline for the percentage when net worth is negative", () => {
    const db = freshDb();
    addAccount(db, "debt", { type: "loan", balanceCents: -500 });
    snap(db, "debt", "2026-09-24", -1000);
    const s = getNetWorthSummary(db, "1M", NOW, TZ);
    expect(s.changeCents).toBe(500); // debt shrank: net worth improved
    expect(s.changePct).toBeCloseTo(0.5);
  });

  it("recomputes when an account is hidden", () => {
    const db = setup();
    snap(db, "chk", "2026-10-23", 600);
    db.update(accounts).set({ isHidden: true }).where(eq(accounts.id, "cc")).run();
    expect(getNetWorthSummary(db, "1M", NOW, TZ)).toMatchObject({ totalCents: 1000, liabilitiesCents: 0 });
  });
});
