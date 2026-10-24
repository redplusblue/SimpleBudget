import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { transactionTags, transactions } from "@/db/schema";
import { findOrCreateTag, listCategories, listTags } from "@/lib/finance/taxonomy";
import { bulkUpdateTransactions, UpdateError, updateTransaction } from "@/lib/finance/transactions-update";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const get = (db: ReturnType<typeof freshDb>, id: number) =>
  db.select().from(transactions).where(eq(transactions.id, id)).get()!;
const tagIds = (db: ReturnType<typeof freshDb>, id: number) =>
  db
    .select()
    .from(transactionTags)
    .where(eq(transactionTags.transactionId, id))
    .all()
    .map((r) => r.tagId)
    .sort();

describe("updateTransaction", () => {
  it("edits only overlay fields, trims text and turns blanks into null", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a", { description: "ORIGINAL", amountCents: -500 });
    const cat = categoryId(db, "Dining");
    updateTransaction(db, t.id, {
      categoryId: cat,
      notes: "  lunch  ",
      payeeOverride: "Cafe",
      isExcluded: true,
      isReviewed: true,
    });
    expect(get(db, t.id)).toMatchObject({
      categoryId: cat,
      notes: "lunch",
      payeeOverride: "Cafe",
      isExcluded: true,
      isReviewed: true,
      description: "ORIGINAL",
      amountCents: -500,
    });
    updateTransaction(db, t.id, { notes: "   ", payeeOverride: "", categoryId: null });
    expect(get(db, t.id)).toMatchObject({ categoryId: null, notes: null, payeeOverride: null, isExcluded: true });
  });

  it("replaces the tag set", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a");
    const [x, y, z] = [addTag(db, "x"), addTag(db, "y"), addTag(db, "z")];
    updateTransaction(db, t.id, { tagIds: [x.id, y.id] });
    expect(tagIds(db, t.id)).toEqual([x.id, y.id]);
    updateTransaction(db, t.id, { tagIds: [y.id, z.id, z.id] });
    expect(tagIds(db, t.id)).toEqual([y.id, z.id]);
    updateTransaction(db, t.id, { tagIds: [] });
    expect(tagIds(db, t.id)).toEqual([]);
  });

  it("flags transfers and unpairs both halves", () => {
    const db = freshDb();
    addAccount(db, "a");
    addAccount(db, "b");
    const x = addTxn(db, "a", { amountCents: -500 });
    const y = addTxn(db, "b", { amountCents: 500 });
    db.update(transactions).set({ isTransfer: true, transferPairId: y.id }).where(eq(transactions.id, x.id)).run();
    db.update(transactions).set({ isTransfer: true, transferPairId: x.id }).where(eq(transactions.id, y.id)).run();
    updateTransaction(db, x.id, { isTransfer: false });
    expect(get(db, x.id)).toMatchObject({ isTransfer: false, transferPairId: null });
    expect(get(db, y.id)).toMatchObject({ isTransfer: false, transferPairId: null });
    updateTransaction(db, x.id, { isTransfer: true });
    expect(get(db, x.id)).toMatchObject({ isTransfer: true, transferPairId: null });
  });

  it("rejects unknown ids, categories and tags without partial writes", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a");
    expect(() => updateTransaction(db, 999, { notes: "x" })).toThrow(UpdateError);
    expect(() => updateTransaction(db, t.id, { notes: "changed", categoryId: 9999 })).toThrow(/Unknown category/);
    expect(() => updateTransaction(db, t.id, { notes: "changed", tagIds: [9999] })).toThrow(/Unknown tag/);
    expect(get(db, t.id).notes).toBeNull();
  });
});

describe("bulkUpdateTransactions", () => {
  it("applies category, flags and tag adds/removes to many rows", () => {
    const db = freshDb();
    addAccount(db, "a");
    const [t1, t2, t3] = [addTxn(db, "a"), addTxn(db, "a"), addTxn(db, "a")];
    const [keep, drop] = [addTag(db, "keep"), addTag(db, "drop")];
    updateTransaction(db, t1.id, { tagIds: [drop.id] });
    const cat = categoryId(db, "Groceries");

    expect(
      bulkUpdateTransactions(db, [t1.id, t2.id, 12345], {
        categoryId: cat,
        isReviewed: true,
        addTagIds: [keep.id],
        removeTagIds: [drop.id],
      }),
    ).toBe(2);
    expect(get(db, t1.id)).toMatchObject({ categoryId: cat, isReviewed: true });
    expect(get(db, t2.id)).toMatchObject({ categoryId: cat, isReviewed: true });
    expect(get(db, t3.id)).toMatchObject({ categoryId: null, isReviewed: false });
    expect(tagIds(db, t1.id)).toEqual([keep.id]);
    expect(tagIds(db, t2.id)).toEqual([keep.id]);
    expect(tagIds(db, t3.id)).toEqual([]);
  });

  it("can clear categories and is idempotent for tags", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a", { categoryId: categoryId(db, "Fees") });
    const tag = addTag(db, "t");
    bulkUpdateTransactions(db, [t.id], { categoryId: null, addTagIds: [tag.id] });
    bulkUpdateTransactions(db, [t.id], { addTagIds: [tag.id] });
    expect(get(db, t.id).categoryId).toBeNull();
    expect(tagIds(db, t.id)).toEqual([tag.id]);
  });

  it("validates input", () => {
    const db = freshDb();
    expect(() => bulkUpdateTransactions(db, [], {})).toThrow(UpdateError);
    expect(() =>
      bulkUpdateTransactions(
        db,
        Array.from({ length: 501 }, (_, i) => i + 1),
        {},
      ),
    ).toThrow(UpdateError);
    expect(() => bulkUpdateTransactions(db, [1], { categoryId: 999 })).toThrow(/Unknown category/);
  });
});

describe("taxonomy", () => {
  it("lists non-archived categories in order", () => {
    const db = freshDb();
    const cats = listCategories(db);
    expect(cats).toHaveLength(15);
    expect(cats[0].name).toBe("Groceries");
    expect(cats.find((c) => c.name === "Income")?.isIncome).toBe(true);
  });

  it("finds or creates tags case-insensitively with rotating palette colors", () => {
    const db = freshDb();
    const a = findOrCreateTag(db, "  Road   Trip ");
    expect(a.name).toBe("Road Trip");
    expect(findOrCreateTag(db, "road trip").id).toBe(a.id);
    const b = findOrCreateTag(db, "Other");
    expect(b.color).not.toBe(a.color);
    expect(listTags(db).map((t) => t.name)).toEqual(["Other", "Road Trip"]);
    expect(() => findOrCreateTag(db, "   ")).toThrow();
    expect(() => findOrCreateTag(db, "x".repeat(41))).toThrow();
  });
});
