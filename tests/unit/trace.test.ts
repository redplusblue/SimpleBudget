import { describe, expect, it } from "vitest";
import { transactionSplits, transactions } from "@/db/schema";
import { zonedDayStart } from "@/lib/finance/dates";
import { similarMerchants, traceTransaction } from "@/lib/finance/trace";
import { createRule } from "@/lib/rules/store";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

function setup() {
  const db = freshDb();
  addAccount(db, "A");
  const add = (date: string, dollars: number, description: string, over = {}) =>
    addTxn(db, "A", { posted: at(date), amountCents: Math.round(dollars * 100), description, ...over });
  const trace = (id: number) => traceTransaction(db, id, NOW, TZ)!;
  return { db, add, trace };
}

describe("traceTransaction", () => {
  it("finds a monthly subscription with a lasting price step", () => {
    const { add, trace } = setup();
    for (const d of ["2026-04-05", "2026-05-05", "2026-06-05"]) add(d, -15.49, "NETFLIX.COM");
    const ids = ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((d) => add(d, -17.99, "NETFLIX.COM").id);
    const t = trace(ids[3]);
    expect(t.stats).toMatchObject({
      count: 7,
      firstDate: "2026-04-05",
      lastDate: "2026-10-05",
      totalSpentCents: 3 * 1549 + 4 * 1799, // 11,843
      medianCents: 1799,
      minCents: 1549,
      maxCents: 1799,
      last12MonthsSpentCents: 11_843,
      averageMonthlyCents: 1692, // 11,843 over 7 active months
    });
    expect(t.cadence).toEqual({ cadence: "monthly", nextExpected: "2026-11-05" });
    expect(t.priceChanges).toEqual([{ date: "2026-07-05", fromCents: 1549, toCents: 1799 }]);
    expect(t.position).toEqual({ percentile: 43, vsMedianPct: 0, isLargest: true, isFirst: false });
    expect(t.byMonth).toHaveLength(24);
    expect(t.byMonth[0]).toEqual({ month: "2026-10", spentCents: 1799, count: 1 });
    expect(t.byMonth.find((m) => m.month === "2026-03")).toEqual({ month: "2026-03", spentCents: 0, count: 0 });
    expect(t.merchant.name).toBe("NETFLIX.COM");
  });

  it("ignores a one-off blip as a price change", () => {
    const { add, trace } = setup();
    for (const d of ["2026-06-05", "2026-07-05"]) add(d, -10, "GYM");
    add("2026-08-05", -12, "GYM"); // blip
    const last = add("2026-09-05", -10, "GYM");
    expect(trace(last.id).priceChanges).toEqual([]);
  });

  it("lists a refund within 60 days after, and not a bigger or later one", () => {
    const { add, trace } = setup();
    const buy = add("2026-10-01", -50, "SHOPCO");
    const refund = add("2026-10-06", 20, "SHOPCO");
    add("2026-10-07", 80, "SHOPCO"); // bigger than the purchase: not a refund of it
    add("2026-08-01", 10, "SHOPCO"); // before the purchase
    expect(trace(buy.id).related.refunds).toEqual([{ id: refund.id, date: "2026-10-06", amountCents: 2000 }]);
  });

  it("flags the same amount twice within 48 hours as a possible duplicate", () => {
    const { add, trace } = setup();
    const a = add("2026-10-10", -9.99, "CAFE ONE");
    const b = add("2026-10-11", -9.99, "CAFE ONE");
    add("2026-10-20", -9.99, "CAFE ONE"); // too far away
    expect(trace(a.id).related.possibleDuplicates).toEqual([{ id: b.id, date: "2026-10-11", amountCents: -999 }]);
    expect(trace(b.id).related.possibleDuplicates.map((d) => d.id)).toEqual([a.id]);
  });

  it("shows how a merchant is categorized, counting split parts", () => {
    const { db, add, trace } = setup();
    const dining = categoryId(db, "Dining");
    const groceries = categoryId(db, "Groceries");
    add("2026-10-01", -5, "MARKET", { categoryId: dining });
    add("2026-10-02", -5, "MARKET", { categoryId: dining });
    add("2026-10-03", -5, "MARKET", { categoryId: groceries });
    const split = add("2026-10-04", -10, "MARKET");
    db.insert(transactionSplits).values({ transactionId: split.id, categoryId: groceries, amountCents: -6_00 }).run();
    db.insert(transactionSplits).values({ transactionId: split.id, categoryId: dining, amountCents: -4_00 }).run();
    expect(trace(split.id).categories).toEqual([
      { name: "Dining", count: 3 },
      { name: "Groceries", count: 2 },
    ]);
  });

  it("computes percentile, median and position for a small set", () => {
    const { add, trace } = setup();
    const ids = [10, 20, 30, 40, 50].map((d, i) => add(`2026-10-0${i + 1}`, -d, "SMALLSHOP").id);
    const t40 = trace(ids[3]);
    expect(t40.stats.medianCents).toBe(3000);
    expect(t40.position).toEqual({ percentile: 60, vsMedianPct: 33, isLargest: false, isFirst: false });
    expect(trace(ids[4]).position).toMatchObject({ percentile: 80, isLargest: true });
    expect(trace(ids[0]).position).toMatchObject({ percentile: 0, isFirst: true, vsMedianPct: -67 });
  });

  it("names the enabled rule that covers the merchant", () => {
    const { db, add, trace } = setup();
    const t = add("2026-10-01", -5, "BLUE BOTTLE COFFEE #1");
    expect(trace(t.id).rule).toBeNull();
    const rule = createRule(db, {
      name: "Coffee",
      match: "any",
      conditions: [{ field: "payee", op: "contains", value: "blue bottle" }],
      actions: { categoryId: categoryId(db, "Dining") },
    });
    expect(trace(t.id).rule).toEqual({ id: rule.id, name: "Coffee" });
  });

  it("works for a row with no merchant key and for a missing id", () => {
    const { db, add, trace } = setup();
    const t = add("2026-10-01", -5, "ODD ONE");
    db.update(transactions).set({ merchantKey: null }).run();
    const r = trace(t.id);
    expect(r.stats.count).toBe(1);
    expect(r.merchant.key).toBeNull();
    expect(r.similarMerchants).toEqual([]);
    expect(traceTransaction(db, 9999, NOW, TZ)).toBeUndefined();
  });
});

describe("similarMerchants", () => {
  it("matches amazon / amazonmktplace but not amzn (a known limit)", () => {
    const { db, add } = setup();
    const a = add("2026-10-01", -5, "AMAZON");
    add("2026-10-02", -5, "AMAZONMKTPLACE");
    add("2026-10-03", -5, "AMZN MKTP US");
    const key = db
      .select()
      .from(transactions)
      .all()
      .find((t) => t.id === a.id)!.merchantKey!;
    const names = similarMerchants(db, key, "AMAZON").map((s) => s.name);
    expect(names).toEqual(["AMAZONMKTPLACE"]);
  });

  it("matches on the first word of the name, and a short key never matches everything", () => {
    const { db, add } = setup();
    const a = add("2026-10-01", -5, "ACME HARDWARE");
    add("2026-10-02", -5, "ACME PIZZA");
    add("2026-10-03", -5, "BP");
    add("2026-10-04", -5, "BPLUS STORE");
    add("2026-10-05", -5, "BPCO");
    const keyOf = (id: number) =>
      db
        .select()
        .from(transactions)
        .all()
        .find((t) => t.id === id)!.merchantKey!;
    expect(similarMerchants(db, keyOf(a.id), "ACME HARDWARE").map((s) => s.name)).toEqual(["ACME PIZZA"]);
    const bp = db
      .select()
      .from(transactions)
      .all()
      .find((t) => t.description === "BP")!.merchantKey!;
    expect(similarMerchants(db, bp, "BP")).toEqual([]);
  });
});
