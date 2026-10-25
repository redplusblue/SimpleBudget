import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { categories, tags, transactionSplits, transactionTags, transactions } from "@/db/schema";
import { unpairTransfer } from "./transfers";

export class UpdateError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

/** User-editable overlay fields; bank-provided fields are never touched here. */
export interface TransactionPatch {
  categoryId?: number | null;
  notes?: string | null;
  payeeOverride?: string | null;
  isExcluded?: boolean;
  isReviewed?: boolean;
  /** `true` flags it as a transfer; `false` clears the flag and unpairs both sides. */
  isTransfer?: boolean;
  /** Replaces the transaction's tags. */
  tagIds?: number[];
}

export interface BulkPatch {
  categoryId?: number | null;
  isExcluded?: boolean;
  isReviewed?: boolean;
  addTagIds?: number[];
  removeTagIds?: number[];
}

export const MAX_BULK = 500;

const blankToNull = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

function assertCategory(db: DbLike, id: number | null | undefined) {
  if (id == null) return;
  if (!db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get()) {
    throw new UpdateError("invalid", "Unknown category");
  }
}

function assertTags(db: DbLike, ids: number[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const found = db.select({ id: tags.id }).from(tags).where(inArray(tags.id, unique)).all();
  if (found.length !== unique.length) throw new UpdateError("invalid", "Unknown tag");
  return unique;
}

const touch = sql`(unixepoch())`;

export function updateTransaction(db: DbLike, id: number, patch: TransactionPatch): void {
  db.transaction((tx) => {
    if (!tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).get()) {
      throw new UpdateError("not_found", "Transaction not found");
    }
    assertCategory(tx, patch.categoryId);
    const tagIds = patch.tagIds ? assertTags(tx, patch.tagIds) : undefined;

    const set: Partial<typeof transactions.$inferInsert> = {};
    if (patch.categoryId !== undefined) {
      set.categoryId = patch.categoryId;
      // Choosing a single category replaces any split.
      tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id)).run();
    }
    if (patch.notes !== undefined) set.notes = blankToNull(patch.notes);
    if (patch.payeeOverride !== undefined) set.payeeOverride = blankToNull(patch.payeeOverride);
    if (patch.isExcluded !== undefined) set.isExcluded = patch.isExcluded;
    if (patch.isReviewed !== undefined) set.isReviewed = patch.isReviewed;
    if (Object.keys(set).length)
      tx.update(transactions)
        .set({ ...set, updatedAt: touch })
        .where(eq(transactions.id, id))
        .run();

    if (patch.isTransfer === false) unpairTransfer(tx, id);
    else if (patch.isTransfer === true) {
      tx.update(transactions).set({ isTransfer: true, updatedAt: touch }).where(eq(transactions.id, id)).run();
    }

    if (tagIds) {
      const existing = tx
        .select({ tagId: transactionTags.tagId })
        .from(transactionTags)
        .where(eq(transactionTags.transactionId, id))
        .all();
      const keep = new Set(tagIds);
      const drop = existing.map((e) => e.tagId).filter((t) => !keep.has(t));
      if (drop.length)
        tx.delete(transactionTags)
          .where(and(eq(transactionTags.transactionId, id), inArray(transactionTags.tagId, drop)))
          .run();
      for (const tagId of tagIds)
        tx.insert(transactionTags).values({ transactionId: id, tagId }).onConflictDoNothing().run();
    }
  });
}

/** Applies one change to many transactions at once. Returns how many existed. */
export function bulkUpdateTransactions(db: DbLike, ids: number[], patch: BulkPatch): number {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > MAX_BULK)
    throw new UpdateError("invalid", `Select between 1 and ${MAX_BULK} transactions`);
  return db.transaction((tx) => {
    assertCategory(tx, patch.categoryId);
    const add = assertTags(tx, patch.addTagIds ?? []);
    const remove = assertTags(tx, patch.removeTagIds ?? []);

    const existing = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(inArray(transactions.id, unique))
      .all()
      .map((r) => r.id);
    if (existing.length === 0) return 0;

    const set: Partial<typeof transactions.$inferInsert> = {};
    if (patch.categoryId !== undefined) {
      set.categoryId = patch.categoryId;
      tx.delete(transactionSplits).where(inArray(transactionSplits.transactionId, existing)).run();
    }
    if (patch.isExcluded !== undefined) set.isExcluded = patch.isExcluded;
    if (patch.isReviewed !== undefined) set.isReviewed = patch.isReviewed;
    if (Object.keys(set).length || add.length || remove.length) {
      tx.update(transactions)
        .set({ ...set, updatedAt: touch })
        .where(inArray(transactions.id, existing))
        .run();
    }
    for (const transactionId of existing)
      for (const tagId of add) tx.insert(transactionTags).values({ transactionId, tagId }).onConflictDoNothing().run();
    if (remove.length)
      tx.delete(transactionTags)
        .where(and(inArray(transactionTags.transactionId, existing), inArray(transactionTags.tagId, remove)))
        .run();
    return existing.length;
  });
}
