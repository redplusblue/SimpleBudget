import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { transactionSplits, transactions } from "@/db/schema";
import { getCategoryBreakdown } from "@/lib/finance/spending";
import { getSpendingReport } from "@/lib/finance/spending-report";
import { zonedDayStart } from "@/lib/finance/dates";
import { getSplits, setSplits, SplitError, splitCounts } from "@/lib/finance/splits";
import { createTarget, getTargetProgress } from "@/lib/finance/targets";
import { mergeCategories, deleteCategory } from "@/lib/finance/taxonomy-admin";
import { queryTransactions } from "@/lib/finance/transactions-query";
import { bulkUpdateTransactions, updateTransaction } from "@/lib/finance/transactions-update";
import { createRule, applyRules } from "@/lib/rules/store";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

/** A $100 Costco trip (Oct 5) that is really $70 groceries + $30 shopping, plus a $50 plain Groceries purchase. */
function dataset() {
  const db = freshDb();
  addAccount(db, "A");
  const [groceries, shopping, dining] = ["Groceries", "Shopping", "Dining"].map((n) => categoryId(db, n));
  const costco = addTxn(db, "A", {
    posted: at("2026-10-05"),
    amountCents: -10_000,
    description: "COSTCO",
    categoryId: groceries,
  });
  const plain = addTxn(db, "A", {
    posted: at("2026-10-06"),
    amountCents: -5_000,
    description: "SUPERMARKET",
    categoryId: groceries,
  });
  return { db, groceries, shopping, dining, costco, plain };
}
const parts = (a: [number | null, number][]) => ({
  parts: a.map(([categoryId, amountCents]) => ({ categoryId, amountCents })),
});

describe("setSplits", () => {
  it("stores parts that add up, and clears the parent's own category", () => {
    const { db, groceries, shopping, costco } = dataset();
    const saved = setSplits(db, costco.id, {
      parts: [
        { categoryId: groceries, amountCents: -7_000 },
        { categoryId: shopping, amountCents: -3_000, notes: " towels " },
      ],
    });
    expect(saved.map((s) => [s.categoryId, s.amountCents, s.notes])).toEqual([
      [groceries, -7_000, null],
      [shopping, -3_000, "towels"],
    ]);
    expect(db.select().from(transactions).where(eq(transactions.id, costco.id)).get()?.categoryId).toBeNull();
    expect(splitCounts(db, [costco.id, 999]).get(costco.id)).toBe(2);
    expect(getSplits(db, costco.id)).toHaveLength(2);
  });

  it("replaces earlier parts and can remove the split", () => {
    const { db, groceries, shopping, dining, costco } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    setSplits(
      db,
      costco.id,
      parts([
        [dining, -2_500],
        [shopping, -7_500],
      ]),
    );
    expect(getSplits(db, costco.id).map((s) => s.amountCents)).toEqual([-2_500, -7_500]);
    expect(setSplits(db, costco.id, { parts: [] })).toEqual([]);
    expect(getSplits(db, costco.id)).toEqual([]);
  });

  it.each([
    ["too few parts", [[1, -10_000]], /at least two/],
    [
      "parts that don't add up (short)",
      [
        [1, -7_000],
        [2, -2_000],
      ],
      /short by 10\.00/,
    ],
    [
      "parts that add up to too much",
      [
        [1, -7_000],
        [2, -4_000],
      ],
      /over by 10\.00/,
    ],
    [
      "a part with the wrong sign",
      [
        [1, -12_000],
        [2, 2_000],
      ],
      /expense/,
    ],
    [
      "an unknown category",
      [
        [9999, -5_000],
        [1, -5_000],
      ],
      /Unknown category/,
    ],
  ] as const)("rejects %s", (_name, p, message) => {
    const { db, costco } = dataset();
    expect(() => setSplits(db, costco.id, parts(p as unknown as [number, number][]))).toThrow(message);
    expect(getSplits(db, costco.id)).toEqual([]);
  });

  it("rejects zero parts, too many parts and unknown transactions", () => {
    const { db, costco } = dataset();
    expect(() =>
      setSplits(
        db,
        costco.id,
        parts([
          [1, 0],
          [1, -10_000],
        ]),
      ),
    ).toThrow();
    expect(() =>
      setSplits(db, costco.id, { parts: Array.from({ length: 21 }, () => ({ categoryId: null, amountCents: -1 })) }),
    ).toThrow();
    expect(() =>
      setSplits(
        db,
        9999,
        parts([
          [1, -1],
          [1, -1],
        ]),
      ),
    ).toThrow(SplitError);
  });

  it("supports income splits and uncategorized parts", () => {
    const { db, groceries } = dataset();
    addAccount(db, "B");
    const pay = addTxn(db, "B", { posted: at("2026-10-01"), amountCents: 20_000, description: "PAY" });
    expect(() =>
      setSplits(
        db,
        pay.id,
        parts([
          [groceries, 12_000],
          [null, 8_000],
        ]),
      ),
    ).not.toThrow();
  });

  it("drops the split automatically when the amount changes", () => {
    const { db, groceries, shopping, costco } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    db.update(transactions).set({ description: "COSTCO #2" }).where(eq(transactions.id, costco.id)).run();
    expect(getSplits(db, costco.id)).toHaveLength(2); // other edits keep it
    db.update(transactions).set({ amountCents: -10_500 }).where(eq(transactions.id, costco.id)).run();
    expect(getSplits(db, costco.id)).toEqual([]);
  });
});

describe("statistics use the parts", () => {
  function split() {
    const d = dataset();
    setSplits(
      d.db,
      d.costco.id,
      parts([
        [d.groceries, -7_000],
        [d.shopping, -3_000],
      ]),
    );
    return d;
  }

  it("the category breakdown counts each part in its own category, with unchanged totals", () => {
    const { db, groceries, shopping } = split();
    const b = getCategoryBreakdown(db, "2026-10", TZ);
    const by = Object.fromEntries(b.items.map((i) => [i.name, i.cents]));
    expect(by).toEqual({ Groceries: 7_000 + 5_000, Shopping: 3_000 });
    expect(b.totalCents).toBe(15_000);
    void groceries;
    void shopping;
  });

  it("the spending report agrees: categories, comparison and totals", () => {
    const { db, groceries, shopping } = split();
    const r = getSpendingReport(db, { month: "2026-10" }, NOW, TZ);
    expect(r.summary.spentCents).toBe(15_000);
    expect(r.summary.purchaseCount).toBe(2); // two purchases, three category lines
    const cat = Object.fromEntries(r.categories.map((c) => [c.id, c.cents]));
    expect(cat).toEqual({ [groceries]: 12_000, [shopping]: 3_000 });
    expect(r.merchants.reduce((s, m) => s + m.cents, 0)).toBe(15_000);
    expect(r.categories.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
  });

  it("targets measure the parts", () => {
    const { db, groceries, shopping } = split();
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 20_000 });
    createTarget(db, { kind: "category", subjectId: shopping, amountCents: 2_000 });
    const by = Object.fromEntries(getTargetProgress(db, "2026-10", NOW, TZ).map((t) => [t.name, t]));
    expect(by.Groceries.spentCents).toBe(12_000);
    expect(by.Shopping).toMatchObject({ spentCents: 3_000, status: "over" });
  });
});

describe("the register", () => {
  it("shows the split count and finds a split purchase under each of its categories", () => {
    const { db, groceries, shopping, dining, costco } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    const page = (f: Parameters<typeof queryTransactions>[1]) =>
      queryTransactions(db, f, { timeZone: TZ, includeTotal: true });
    expect(page({}).rows.find((r) => r.id === costco.id)).toMatchObject({ splitCount: 2, categoryId: null });
    expect(page({ categoryId: shopping }).rows.map((r) => r.id)).toEqual([costco.id]);
    expect(page({ categoryId: groceries }).total).toBe(2);
    expect(page({ categoryId: dining }).total).toBe(0);
    expect(page({ categoryId: "none" }).total).toBe(0); // fully categorized through its parts
  });

  it("an uncategorized part keeps it in the uncategorized view", () => {
    const { db, groceries, costco } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [null, -3_000],
      ]),
    );
    const none = queryTransactions(db, { categoryId: "none" }, { timeZone: TZ, includeTotal: true });
    expect(none.rows.map((r) => r.id)).toEqual([costco.id]);
  });
});

describe("other writers respect splits", () => {
  it("choosing a single category replaces the split (single and bulk)", () => {
    const { db, groceries, shopping, dining, costco, plain } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    updateTransaction(db, costco.id, { categoryId: dining });
    expect(getSplits(db, costco.id)).toEqual([]);
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    updateTransaction(db, costco.id, { notes: "just a note" });
    expect(getSplits(db, costco.id)).toHaveLength(2);
    bulkUpdateTransactions(db, [costco.id, plain.id], { categoryId: dining });
    expect(getSplits(db, costco.id)).toEqual([]);
  });

  it("rules never overwrite a split with a single category", () => {
    const { db, groceries, shopping, dining, costco } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    createRule(db, {
      name: "Costco",
      conditions: [{ field: "description", op: "contains", value: "costco" }],
      actions: { categoryId: dining },
    });
    applyRules(db, { overwrite: true });
    expect(getSplits(db, costco.id)).toHaveLength(2);
    expect(db.select().from(transactions).where(eq(transactions.id, costco.id)).get()?.categoryId).toBeNull();
  });

  it("merging categories moves the parts; deleting leaves them uncategorized", () => {
    const { db, groceries, shopping, dining, costco } = dataset();
    setSplits(
      db,
      costco.id,
      parts([
        [groceries, -7_000],
        [shopping, -3_000],
      ]),
    );
    mergeCategories(db, shopping, dining);
    expect(getSplits(db, costco.id).map((s) => s.categoryId)).toEqual([groceries, dining]);
    expect(deleteCategory(db, dining).uncategorized).toBeGreaterThanOrEqual(1);
    expect(getSplits(db, costco.id).map((s) => s.categoryId)).toEqual([groceries, null]);
    expect(db.select().from(transactionSplits).all()).toHaveLength(2);
  });
});
