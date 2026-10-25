import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { budgets, categories, tags, transactionTags, transactions } from "@/db/schema";
import { listCategories } from "@/lib/finance/taxonomy";
import {
  createCategory,
  deleteCategory,
  deleteTag,
  listCategoriesAdmin,
  listTagsAdmin,
  mergeCategories,
  reorderCategories,
  TaxonomyError,
  updateCategory,
  updateTag,
} from "@/lib/finance/taxonomy-admin";
import { categoryInputSchema } from "@/lib/finance/taxonomy-schemas";
import { createRule, getRule, listRules } from "@/lib/rules/store";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const input = (name: string) => ({ name, color: "#6366F1", icon: "tag" as const, groupName: "Fun" });

describe("categories", () => {
  it("creates at the end, with transaction counts and normalized fields", () => {
    const db = freshDb();
    const c = createCategory(db, { name: "  Pets ", color: "#10B981", groupName: "  ", isIncome: false });
    expect(c).toMatchObject({ name: "Pets", groupName: null, icon: null, txnCount: 0, sortOrder: 15 });
    const rows = listCategoriesAdmin(db);
    expect(rows).toHaveLength(16);
    expect(rows[15].id).toBe(c.id);
  });

  it("counts transactions per category", () => {
    const db = freshDb();
    addAccount(db, "a");
    const g = categoryId(db, "Groceries");
    addTxn(db, "a", { categoryId: g });
    addTxn(db, "a", { categoryId: g });
    addTxn(db, "a");
    expect(listCategoriesAdmin(db).find((c) => c.id === g)!.txnCount).toBe(2);
    expect(listCategoriesAdmin(db).find((c) => c.name === "Dining")!.txnCount).toBe(0);
  });

  it("rejects duplicate names case-insensitively, including on rename", () => {
    const db = freshDb();
    expect(() => createCategory(db, input("groceries"))).toThrow(TaxonomyError);
    const c = createCategory(db, input("Pets"));
    expect(() => updateCategory(db, c.id, { name: "DINING" })).toThrow(/already exists/);
    updateCategory(db, c.id, { name: "pets" }); // renaming to itself (different case) is fine
    expect(listCategoriesAdmin(db).find((x) => x.id === c.id)!.name).toBe("pets");
  });

  it("validates input and patches", () => {
    expect(categoryInputSchema.safeParse({ name: "", color: "#000000" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "x", color: "red" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "x", color: "#000000", icon: "not-an-icon" }).success).toBe(false);
    const db = freshDb();
    expect(() => updateCategory(db, 1, {})).toThrow();
    expect(() => updateCategory(db, 9999, { name: "Nope" })).toThrow(/not found/);
  });

  it("archives and unarchives without touching transactions; listCategories still returns them flagged", () => {
    const db = freshDb();
    addAccount(db, "a");
    const g = categoryId(db, "Groceries");
    const t = addTxn(db, "a", { categoryId: g });
    updateCategory(db, g, { isArchived: true });
    expect(listCategories(db).find((c) => c.id === g)).toMatchObject({ isArchived: true });
    expect(db.select().from(transactions).where(eq(transactions.id, t.id)).get()!.categoryId).toBe(g);
    updateCategory(db, g, { isArchived: false });
    expect(listCategories(db).find((c) => c.id === g)!.isArchived).toBe(false);
  });

  it("reorders; a stale list is tolerated", () => {
    const db = freshDb();
    const ids = listCategoriesAdmin(db).map((c) => c.id);
    reorderCategories(db, [...ids].reverse());
    expect(listCategoriesAdmin(db).map((c) => c.id)).toEqual([...ids].reverse());
    // missing ids keep their relative order after the listed ones; unknown ids are ignored
    reorderCategories(db, [ids[3], 9999, ids[1]]);
    const after = listCategoriesAdmin(db).map((c) => c.id);
    expect(after.slice(0, 2)).toEqual([ids[3], ids[1]]);
    expect(after).toHaveLength(ids.length);
    expect(() => reorderCategories(db, [ids[0], ids[0]])).toThrow(TaxonomyError);
  });
});

describe("merging categories", () => {
  it("moves every transaction, budget and rule, then removes the source", () => {
    const db = freshDb();
    addAccount(db, "a");
    const [from, into] = [categoryId(db, "Dining"), categoryId(db, "Groceries")];
    const moved = [addTxn(db, "a", { categoryId: from }), addTxn(db, "a", { categoryId: from })];
    const stays = addTxn(db, "a", { categoryId: into });
    const other = addTxn(db, "a", { categoryId: categoryId(db, "Fees") });
    db.insert(budgets).values({ categoryId: from, amountCents: 40_000 }).run();
    const rule = createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "cafe" }],
      actions: { categoryId: from },
    });

    expect(mergeCategories(db, from, into)).toEqual({ moved: 2 });
    const cat = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get()!.categoryId;
    expect(moved.map((t) => cat(t.id))).toEqual([into, into]);
    expect(cat(stays.id)).toBe(into);
    expect(cat(other.id)).toBe(categoryId(db, "Fees"));
    expect(db.select().from(categories).where(eq(categories.id, from)).get()).toBeUndefined();
    expect(db.select().from(budgets).get()!.categoryId).toBe(into);
    expect(getRule(db, rule.id)!.actions.categoryId).toBe(into);
  });

  it("validates ids", () => {
    const db = freshDb();
    const g = categoryId(db, "Groceries");
    expect(() => mergeCategories(db, g, g)).toThrow(/different/);
    expect(() => mergeCategories(db, g, 9999)).toThrow(/not found/);
    expect(() => mergeCategories(db, 9999, g)).toThrow(/not found/);
    expect(db.select().from(categories).where(eq(categories.id, g)).get()).toBeDefined();
  });
});

describe("deleting categories", () => {
  it("uncategorizes its transactions and scrubs rules", () => {
    const db = freshDb();
    addAccount(db, "a");
    const [dining, groceries] = [categoryId(db, "Dining"), categoryId(db, "Groceries")];
    const t = addTxn(db, "a", { categoryId: dining });
    addTxn(db, "a", { categoryId: dining });
    const tag = addTag(db, "x");
    createRule(db, { conditions: [{ field: "payee", op: "contains", value: "a" }], actions: { categoryId: dining } });
    createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "b" }],
      actions: { categoryId: dining, addTagIds: [tag.id] },
    });
    createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "c" }],
      actions: { categoryId: groceries },
    });

    expect(deleteCategory(db, dining)).toEqual({ uncategorized: 2, rulesRewritten: 1, rulesRemoved: 1 });
    expect(db.select().from(transactions).where(eq(transactions.id, t.id)).get()!.categoryId).toBeNull();
    expect(listRules(db)).toHaveLength(2);
    expect(() => deleteCategory(db, dining)).toThrow(/not found/);
  });
});

describe("tags", () => {
  it("lists with counts, renames (unique, case-insensitive) and recolors", () => {
    const db = freshDb();
    addAccount(db, "a");
    const [a, b] = [addTag(db, "alpha"), addTag(db, "beta")];
    const t = addTxn(db, "a");
    db.insert(transactionTags).values({ transactionId: t.id, tagId: a.id }).run();
    expect(listTagsAdmin(db).map((x) => [x.name, x.txnCount])).toEqual([
      ["alpha", 1],
      ["beta", 0],
    ]);
    updateTag(db, a.id, { name: "  Alpha   One ", color: "#F59E0B" });
    expect(db.select().from(tags).where(eq(tags.id, a.id)).get()).toMatchObject({
      name: "Alpha One",
      color: "#F59E0B",
    });
    expect(() => updateTag(db, b.id, { name: "alpha one" })).toThrow(/already exists/);
    expect(() => updateTag(db, 9999, { name: "x" })).toThrow(/not found/);
    expect(() => updateTag(db, a.id, { color: "nope" })).toThrow();
  });

  it("deleting a tag untags transactions and scrubs rules", () => {
    const db = freshDb();
    addAccount(db, "a");
    const [keep, drop] = [addTag(db, "keep"), addTag(db, "drop")];
    const t = addTxn(db, "a");
    db.insert(transactionTags)
      .values([
        { transactionId: t.id, tagId: keep.id },
        { transactionId: t.id, tagId: drop.id },
      ])
      .run();
    const rule = createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "x" }],
      actions: { addTagIds: [keep.id, drop.id] },
    });
    expect(deleteTag(db, drop.id)).toEqual({ untagged: 1, rulesRewritten: 1, rulesRemoved: 0 });
    expect(
      db
        .select()
        .from(transactionTags)
        .all()
        .map((l) => l.tagId),
    ).toEqual([keep.id]);
    expect(getRule(db, rule.id)!.actions.addTagIds).toEqual([keep.id]);
  });
});
