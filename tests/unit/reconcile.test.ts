import { describe, expect, it } from "vitest";
import { zonedDayStart } from "@/lib/finance/dates";
import { balanceAtEndOfDay, ReconcileError, reconcile } from "@/lib/finance/reconcile";
import { getTransactionRows, queryTransactions } from "@/lib/finance/transactions-query";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string, h = 12) => zonedDayStart(date, TZ) + h * 3600;

/** Balance today $1,000.00. Posted: Oct 1 +$2,000, Oct 5 -$300, Oct 10 -$200, Oct 20 -$500; a pending -$40. */
function dataset() {
  const db = freshDb();
  addAccount(db, "A", { balanceCents: 100_000 });
  const t = (date: string, cents: number, over: object = {}) =>
    addTxn(db, "A", { posted: at(date), amountCents: cents, ...over });
  const rows = [t("2026-10-01", 200_000), t("2026-10-05", -30_000), t("2026-10-10", -20_000), t("2026-10-20", -50_000)];
  addTxn(db, "A", { posted: 0, pending: true, transactedAt: at("2026-10-23"), amountCents: -4_000 });
  return { db, rows };
}

describe("balanceAtEndOfDay", () => {
  it("works backwards from the current balance, ignoring pending items", () => {
    const { db } = dataset();
    expect(balanceAtEndOfDay(db, "A", "2026-10-24", TZ)).toBe(100_000);
    expect(balanceAtEndOfDay(db, "A", "2026-10-19", TZ)).toBe(150_000); // before the Oct 20 -$500
    expect(balanceAtEndOfDay(db, "A", "2026-10-20", TZ)).toBe(100_000); // the whole day counts
    expect(balanceAtEndOfDay(db, "A", "2026-10-09", TZ)).toBe(170_000);
    expect(balanceAtEndOfDay(db, "A", "2026-09-30", TZ)).toBe(0);
    expect(() => balanceAtEndOfDay(db, "nope", "2026-10-01", TZ)).toThrow(ReconcileError);
  });

  it("agrees with the register's running balance", () => {
    const { db, rows } = dataset();
    const page = queryTransactions(db, { accountId: "A" }, { timeZone: TZ });
    for (const r of page.rows.filter((r) => !r.pending)) {
      const date = new Date(r.posted * 1000).toISOString().slice(0, 10);
      expect(balanceAtEndOfDay(db, "A", date, TZ)).toBe(r.runningBalanceCents);
    }
    void rows;
  });

  it("uses the local day in the user's time zone", () => {
    const db = freshDb();
    addAccount(db, "A", { balanceCents: 10_000 });
    // 2026-10-02 03:00 UTC is still Oct 1 in New York
    addTxn(db, "A", { posted: zonedDayStart("2026-10-02", "UTC") + 3 * 3600, amountCents: -1_000 });
    expect(balanceAtEndOfDay(db, "A", "2026-10-01", "America/New_York")).toBe(10_000);
    expect(balanceAtEndOfDay(db, "A", "2026-10-01", "UTC")).toBe(11_000);
  });
});

describe("reconcile", () => {
  it("reports a match", () => {
    const { db } = dataset();
    expect(reconcile(db, "A", { date: "2026-10-10", balanceCents: 150_000 }, TZ)).toMatchObject({
      appCents: 150_000,
      differenceCents: 0,
      matches: true,
      unreviewedCount: 3,
      markedReviewed: 0,
      pendingCount: 1,
    });
  });

  it("reports the difference when the bank and the app disagree", () => {
    const { db } = dataset();
    const r = reconcile(db, "A", { date: "2026-10-10", balanceCents: 147_500 }, TZ);
    expect(r).toMatchObject({ bankCents: 147_500, appCents: 150_000, differenceCents: -2_500, matches: false });
  });

  it("marks transactions up to the date reviewed, only when it matches", () => {
    const { db } = dataset();
    expect(() => reconcile(db, "A", { date: "2026-10-10", balanceCents: 1, markReviewed: true }, TZ)).toThrow(
      /don't match/,
    );
    expect(queryTransactions(db, { status: "reviewed" }, { timeZone: TZ }).rows).toHaveLength(0);
    const r = reconcile(db, "A", { date: "2026-10-10", balanceCents: 150_000, markReviewed: true }, TZ);
    expect(r).toMatchObject({ markedReviewed: 3, unreviewedCount: 0 });
    const reviewed = getTransactionRows(
      db,
      queryTransactions(db, { status: "reviewed" }, { timeZone: TZ }).rows.map((x) => x.id),
    );
    expect(reviewed.map((x) => x.amountCents).sort((a, b) => a - b)).toEqual([-30_000, -20_000, 200_000]);
    // the later transactions and the pending one are untouched
    expect(queryTransactions(db, { status: "unreviewed" }, { timeZone: TZ }).rows).toHaveLength(2);
    expect(
      reconcile(db, "A", { date: "2026-10-10", balanceCents: 150_000, markReviewed: true }, TZ).markedReviewed,
    ).toBe(0); // idempotent
  });

  it("validates input", () => {
    const { db } = dataset();
    expect(() => reconcile(db, "A", { date: "yesterday", balanceCents: 1 }, TZ)).toThrow();
    expect(() => reconcile(db, "A", { date: "2026-10-10", balanceCents: 1.5 }, TZ)).toThrow();
    expect(() => reconcile(db, "nope", { date: "2026-10-10", balanceCents: 1 }, TZ)).toThrow(/not found/);
  });
});
