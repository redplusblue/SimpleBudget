import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { budgets, categories, tags, transactionTags, transactions } from "@/db/schema";
import { scrubCategoryFromRules, scrubTagFromRules } from "@/lib/rules/store";
import {
  categoryInputSchema,
  categoryPatchSchema,
  tagPatchSchema,
  type CategoryAdminRow,
  type CategoryInput,
  type CategoryPatch,
  type TagAdminRow,
  type TagPatch,
} from "./taxonomy-schemas";

export class TaxonomyError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

// ── categories ──────────────────────────────────────────────────────────────

export function listCategoriesAdmin(db: DbLike): CategoryAdminRow[] {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      groupName: categories.groupName,
      color: categories.color,
      icon: categories.icon,
      isIncome: categories.isIncome,
      sortOrder: categories.sortOrder,
      isArchived: categories.isArchived,
      txnCount: count(transactions.id),
    })
    .from(categories)
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(categories.sortOrder, categories.id)
    .all();
}

function assertNameFree(db: DbLike, name: string, exceptId?: number) {
  const clash = db
    .select({ id: categories.id })
    .from(categories)
    .where(sql`lower(${categories.name}) = ${name.toLowerCase()}`)
    .all()
    .some((c) => c.id !== exceptId);
  if (clash) throw new TaxonomyError("conflict", "A category with that name already exists");
}

export function createCategory(db: DbLike, input: CategoryInput): CategoryAdminRow {
  const v = categoryInputSchema.parse(input);
  assertNameFree(db, v.name);
  const next =
    (db
      .select({ m: sql<number>`coalesce(max(${categories.sortOrder}), -1)` })
      .from(categories)
      .get()?.m ?? -1) + 1;
  const row = db
    .insert(categories)
    .values({ ...v, sortOrder: next })
    .returning()
    .get();
  return { ...row, txnCount: 0 };
}

export function updateCategory(db: DbLike, id: number, patch: CategoryPatch): void {
  const v = categoryPatchSchema.parse(patch);
  if (!db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get())
    throw new TaxonomyError("not_found", "Category not found");
  if (v.name !== undefined) assertNameFree(db, v.name, id);
  db.update(categories).set(v).where(eq(categories.id, id)).run();
}

/**
 * Sets the display order from `ids`. The list may be slightly stale (another tab added or removed a category):
 * unknown ids are ignored and categories that aren't listed keep their relative order after the listed ones.
 */
export function reorderCategories(db: DbLike, ids: number[]): void {
  if (new Set(ids).size !== ids.length) throw new TaxonomyError("invalid", "Each category can only be listed once");
  const existing = db
    .select({ id: categories.id })
    .from(categories)
    .orderBy(categories.sortOrder, categories.id)
    .all()
    .map((c) => c.id);
  const known = new Set(existing);
  const order = [...ids.filter((id) => known.has(id)), ...existing.filter((id) => !ids.includes(id))];
  db.transaction((tx) =>
    order.forEach((id, i) => tx.update(categories).set({ sortOrder: i }).where(eq(categories.id, id)).run()),
  );
}

export interface MergeResult {
  moved: number;
  /** Targets of the merged category dropped because the destination already had one for the same scope. */
  targetsDropped: number;
}

/** Moves every transaction (and budget and rule) from `from` to `into`, then deletes `from`. */
export function mergeCategories(db: DbLike, from: number, into: number): MergeResult {
  if (from === into) throw new TaxonomyError("invalid", "Choose a different category to merge into");
  return db.transaction((tx) => {
    for (const id of [from, into]) {
      if (!tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get())
        throw new TaxonomyError("not_found", "Category not found");
    }
    const moved = tx
      .update(transactions)
      .set({ categoryId: into, updatedAt: sql`(unixepoch())` })
      .where(eq(transactions.categoryId, from))
      .returning({ id: transactions.id })
      .all().length;
    // Targets follow the merge; where the destination already has one for the same scope, its own target wins.
    let targetsDropped = 0;
    for (const b of tx.select().from(budgets).where(eq(budgets.categoryId, from)).all()) {
      const clash = tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(and(eq(budgets.categoryId, into), b.month === null ? isNull(budgets.month) : eq(budgets.month, b.month)))
        .get();
      if (clash) {
        tx.delete(budgets).where(eq(budgets.id, b.id)).run();
        targetsDropped++;
      } else {
        tx.update(budgets).set({ categoryId: into }).where(eq(budgets.id, b.id)).run();
      }
    }
    scrubCategoryFromRules(tx, from, into);
    tx.delete(categories).where(eq(categories.id, from)).run();
    return { moved, targetsDropped };
  });
}

export interface DeleteCategoryResult {
  uncategorized: number;
  rulesRewritten: number;
  rulesRemoved: number;
}

/** Deletes a category; its transactions become uncategorized and rules stop referencing it. */
export function deleteCategory(db: DbLike, id: number): DeleteCategoryResult {
  return db.transaction((tx) => {
    if (!tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get())
      throw new TaxonomyError("not_found", "Category not found");
    const uncategorized =
      tx.select({ n: count() }).from(transactions).where(eq(transactions.categoryId, id)).get()?.n ?? 0;
    const rules = scrubCategoryFromRules(tx, id, null);
    tx.delete(categories).where(eq(categories.id, id)).run(); // FK: transactions -> null, budgets cascade
    return { uncategorized, rulesRewritten: rules.rewritten, rulesRemoved: rules.removed };
  });
}

// ── tags ────────────────────────────────────────────────────────────────────

export function listTagsAdmin(db: DbLike): TagAdminRow[] {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color, txnCount: count(transactionTags.transactionId) })
    .from(tags)
    .leftJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(tags.name)
    .all();
}

export function updateTag(db: DbLike, id: number, patch: TagPatch): void {
  const v = tagPatchSchema.parse(patch);
  if (!db.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get())
    throw new TaxonomyError("not_found", "Tag not found");
  if (v.name !== undefined) {
    const name = v.name.replace(/\s+/g, " ");
    const clash = db
      .select({ id: tags.id })
      .from(tags)
      .where(sql`lower(${tags.name}) = ${name.toLowerCase()}`)
      .all()
      .some((t) => t.id !== id);
    if (clash) throw new TaxonomyError("conflict", "A tag with that name already exists");
    v.name = name;
  }
  db.update(tags).set(v).where(eq(tags.id, id)).run();
}

export interface DeleteTagResult {
  untagged: number;
  rulesRewritten: number;
  rulesRemoved: number;
}

export function deleteTag(db: DbLike, id: number): DeleteTagResult {
  return db.transaction((tx) => {
    if (!tx.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).get())
      throw new TaxonomyError("not_found", "Tag not found");
    const untagged = tx.select({ n: count() }).from(transactionTags).where(eq(transactionTags.tagId, id)).get()?.n ?? 0;
    const rules = scrubTagFromRules(tx, id);
    tx.delete(tags)
      .where(inArray(tags.id, [id]))
      .run(); // FK cascade removes the links
    return { untagged, rulesRewritten: rules.rewritten, rulesRemoved: rules.removed };
  });
}
