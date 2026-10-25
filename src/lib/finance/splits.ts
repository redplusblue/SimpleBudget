import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { categories, transactionSplits, transactions } from "@/db/schema";

export class SplitError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const MAX_SPLITS = 20;

export const splitPartSchema = z.object({
  categoryId: z.number().int().positive().nullable(),
  /** Same sign as the transaction, in cents. */
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0, "Each part needs an amount"),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((n) => n || null),
});
export const setSplitsSchema = z.object({ parts: z.array(splitPartSchema).max(MAX_SPLITS) });

export type SplitPartInput = z.input<typeof splitPartSchema>;

export interface SplitPart {
  id: number;
  categoryId: number | null;
  amountCents: number;
  notes: string | null;
}

export function getSplits(db: DbLike, transactionId: number): SplitPart[] {
  return db
    .select({
      id: transactionSplits.id,
      categoryId: transactionSplits.categoryId,
      amountCents: transactionSplits.amountCents,
      notes: transactionSplits.notes,
    })
    .from(transactionSplits)
    .where(eq(transactionSplits.transactionId, transactionId))
    .orderBy(transactionSplits.id)
    .all();
}

/**
 * Replaces a transaction's splits. Two or more parts are required and they must add up exactly to the amount, with
 * the same sign. The transaction itself becomes uncategorized (its parts carry the categories). An empty list removes
 * the split and leaves the transaction uncategorized.
 */
export function setSplits(db: DbLike, transactionId: number, input: unknown): SplitPart[] {
  const { parts } = setSplitsSchema.parse(input);
  return db.transaction((tx) => {
    const txn = tx
      .select({ id: transactions.id, amountCents: transactions.amountCents })
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .get();
    if (!txn) throw new SplitError("not_found", "Transaction not found");

    if (parts.length === 0) {
      tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId)).run();
      return [];
    }
    if (parts.length < 2) throw new SplitError("invalid", "A split needs at least two parts");
    const sign = Math.sign(txn.amountCents);
    if (sign === 0) throw new SplitError("invalid", "A zero-amount transaction can't be split");
    if (parts.some((p) => Math.sign(p.amountCents) !== sign))
      throw new SplitError(
        "invalid",
        sign < 0
          ? "Every part must be an expense, like the transaction"
          : "Every part must be income, like the transaction",
      );
    const total = parts.reduce((s, p) => s + p.amountCents, 0);
    if (total !== txn.amountCents) {
      const diff = Math.abs(txn.amountCents - total);
      throw new SplitError(
        "invalid",
        `The parts must add up to the transaction amount (${Math.abs(total) > Math.abs(txn.amountCents) ? "over" : "short"} by ${(diff / 100).toFixed(2)})`,
      );
    }
    const ids = [...new Set(parts.map((p) => p.categoryId).filter((c): c is number => c !== null))];
    if (
      ids.length &&
      tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, ids)).all().length !== ids.length
    )
      throw new SplitError("invalid", "Unknown category");

    tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId)).run();
    tx.insert(transactionSplits)
      .values(
        parts.map((p) => ({ transactionId, categoryId: p.categoryId, amountCents: p.amountCents, notes: p.notes })),
      )
      .run();
    tx.update(transactions).set({ categoryId: null }).where(eq(transactions.id, transactionId)).run();
    return getSplits(tx, transactionId);
  });
}

/** Number of splits per transaction, for the given ids. */
export function splitCounts(db: DbLike, ids: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  for (const r of db
    .select({ t: transactionSplits.transactionId })
    .from(transactionSplits)
    .where(inArray(transactionSplits.transactionId, ids))
    .all())
    map.set(r.t, (map.get(r.t) ?? 0) + 1);
  return map;
}
