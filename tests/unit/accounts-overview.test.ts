import { describe, expect, it } from "vitest";
import { balanceSnapshots } from "@/db/schema";
import {
  accountMonthStats,
  balanceSeries,
  getAccountDetail,
  getAccountsOverview,
  STALE_AFTER_SECONDS,
} from "@/lib/finance/accounts-overview";
import { groupKeyFor } from "@/lib/finance/account-types";
import { zonedDayStart } from "@/lib/finance/dates";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const TZ = "UTC";
const day = (d: string) => zonedDayStart(d, TZ);
const NOW = day("2026-10-24") + 12 * 3600;

const snap = (db: ReturnType<typeof freshDb>, accountId: string, date: string, balanceCents: number) =>
  db.insert(balanceSnapshots).values({ accountId, date, balanceCents }).run();

describe("balanceSeries", () => {
  it("carries balances forward over missing days and ends today", () => {
    const db = freshDb();
    addAccount(db, "a");
    snap(db, "a", "2026-10-20", 100);
    snap(db, "a", "2026-10-23", 150);
    const s = balanceSeries(db, "a", 7, NOW, TZ);
    expect(s.map((p) => p.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(s.map((p) => p.balanceCents)).toEqual([100, 100, 100, 150, 150]);
  });

  it("starts from the latest snapshot before the window, never from zero", () => {
    const db = freshDb();
    addAccount(db, "a");
    snap(db, "a", "2026-01-01", 500);
    const s = balanceSeries(db, "a", 3, NOW, TZ);
    expect(s).toHaveLength(3);
    expect(s.every((p) => p.balanceCents === 500)).toBe(true);
  });

  it("omits days before an account's first snapshot and handles no data", () => {
    const db = freshDb();
    addAccount(db, "a");
    addAccount(db, "empty");
    snap(db, "a", "2026-10-23", 10);
    expect(balanceSeries(db, "a", 30, NOW, TZ)).toHaveLength(2);
    expect(balanceSeries(db, "empty", 30, NOW, TZ)).toEqual([]);
  });
});

describe("getAccountsOverview", () => {
  function setup() {
    const db = freshDb();
    addAccount(db, "chk", { name: "Checking", balanceCents: 500_000, balanceDate: NOW - 60 });
    addAccount(db, "sav", { name: "Savings", type: "savings", balanceCents: 1_000_000, balanceDate: NOW - 60 });
    addAccount(db, "cc", {
      name: "Card",
      type: "credit",
      balanceCents: -120_000,
      balanceDate: NOW - STALE_AFTER_SECONDS - 1,
    });
    addAccount(db, "ira", { name: "IRA", type: "investment", balanceCents: 7_000_000 });
    addAccount(db, "old", { name: "Old", isClosed: true, balanceCents: 0 });
    addAccount(db, "secret", { name: "Secret", isHidden: true, balanceCents: 1 });
    snap(db, "chk", "2026-10-22", 400_000);
    snap(db, "chk", "2026-10-24", 500_000);
    return db;
  }

  it("groups accounts in display order with totals and hides hidden accounts", () => {
    const groups = getAccountsOverview(setup(), NOW, TZ);
    expect(groups.map((g) => g.key)).toEqual(["cash", "credit", "investments", "closed"]);
    const cash = groups[0];
    expect(cash.totalCents).toBe(1_500_000);
    expect(cash.accounts.map((a) => a.id)).toEqual(expect.arrayContaining(["chk", "sav"]));
    expect(groups.flatMap((g) => g.accounts).some((a) => a.id === "secret")).toBe(false);
    expect(groups[1].totalCents).toBe(-120_000); // credit balances stay negative
  });

  it("can include hidden accounts", () => {
    const groups = getAccountsOverview(setup(), NOW, TZ, true);
    expect(groups.flatMap((g) => g.accounts).some((a) => a.id === "secret")).toBe(true);
  });

  it("flags stale balances, including accounts that never reported a date", () => {
    const flat = getAccountsOverview(setup(), NOW, TZ).flatMap((g) => g.accounts);
    const stale = Object.fromEntries(flat.map((a) => [a.id, a.stale]));
    expect(stale).toMatchObject({ chk: false, cc: true, ira: true });
  });

  it("includes a 30 day sparkline from snapshots", () => {
    const chk = getAccountsOverview(setup(), NOW, TZ)[0].accounts.find((a) => a.id === "chk")!;
    expect(chk.sparkline).toEqual([400_000, 400_000, 500_000]);
  });

  it("maps closed accounts to the closed group regardless of type", () => {
    expect(groupKeyFor("credit", true)).toBe("closed");
    expect(groupKeyFor("other", false)).toBe("other");
    expect(groupKeyFor("loan", false)).toBe("loans");
  });
});

describe("accountMonthStats / getAccountDetail", () => {
  it("sums posted money in and out for the month, skipping pending and excluded items", () => {
    const db = freshDb();
    addAccount(db, "a", { balanceCents: 1000 });
    addTxn(db, "a", { posted: day("2026-10-02"), amountCents: 300_000 });
    addTxn(db, "a", { posted: day("2026-10-10"), amountCents: -45_000 });
    addTxn(db, "a", { posted: day("2026-10-11"), amountCents: -5_000, isTransfer: true }); // transfers count as movement
    addTxn(db, "a", { posted: day("2026-10-12"), amountCents: -9_999, isExcluded: true });
    addTxn(db, "a", { posted: 0, pending: true, transactedAt: day("2026-10-23"), amountCents: -7_000 });
    addTxn(db, "a", { posted: day("2026-09-30") + 86_399, amountCents: -1_000 }); // last month
    addTxn(db, "a", { posted: day("2026-11-01"), amountCents: -2_000 }); // next month
    expect(accountMonthStats(db, "a", "2026-10", TZ)).toEqual({
      month: "2026-10",
      inCents: 300_000,
      outCents: 50_000,
      netCents: 250_000,
    });
  });

  it("uses the user's timezone for month boundaries", () => {
    const db = freshDb();
    addAccount(db, "a");
    // 2026-11-01T02:00Z is still October 31st in New York.
    addTxn(db, "a", { posted: day("2026-11-01") + 2 * 3600, amountCents: -100 });
    expect(accountMonthStats(db, "a", "2026-10", "America/New_York").outCents).toBe(100);
    expect(accountMonthStats(db, "a", "2026-11", "America/New_York").outCents).toBe(0);
    expect(accountMonthStats(db, "a", "2026-11", "UTC").outCents).toBe(100);
  });

  it("returns detail for an account, or undefined", () => {
    const db = freshDb();
    addAccount(db, "a", { name: "Main", displayName: "Everyday", balanceCents: 42 });
    snap(db, "a", "2026-10-24", 42);
    const d = getAccountDetail(db, "a", NOW, TZ)!;
    expect(d.account).toMatchObject({ label: "Everyday", balanceCents: 42 });
    expect(d.stats.month).toBe("2026-10");
    expect(d.series).toEqual([{ date: "2026-10-24", balanceCents: 42 }]);
    expect(getAccountDetail(db, "nope", NOW, TZ)).toBeUndefined();
  });
});
