import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { ACCOUNT_TYPES, accounts, balanceSnapshots, categories, transactionSplits, transactions } from "@/db/schema";
import { isDateString, localDateString, zonedDayStart } from "./dates";
import { unpairTransfer } from "./transfers";

export class ManualError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const MAX_CENTS = 100_000_000_00;
const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);

export const manualAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  type: z.enum(ACCOUNT_TYPES).default("cash"),
  /** Starting balance in cents (negative for money owed). */
  balanceCents: cents.default(0),
});

export const manualTransactionSchema = z.object({
  /** Local date, `YYYY-MM-DD`. */
  date: z.string().refine(isDateString, "Enter a date like 2026-10-24"),
  /** Negative = money out. */
  amountCents: cents.refine((n) => n !== 0, "Enter an amount"),
  description: z.string().trim().min(1, "Enter a description").max(200),
  categoryId: z.number().int().positive().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const manualTransactionPatchSchema = manualTransactionSchema.partial().strict();

export type ManualAccountInput = z.input<typeof manualAccountSchema>;
export type ManualTransactionInput = z.input<typeof manualTransactionSchema>;
export type ManualTransactionPatch = z.input<typeof manualTransactionPatchSchema>;

/** Writes the balance and today's snapshot together, so the net-worth chart follows manual changes too. */
function writeBalance(db: DbLike, accountId: string, balanceCents: number, now: number, timeZone: string) {
  db.update(accounts).set({ balanceCents, balanceDate: now, updatedAt: now }).where(eq(accounts.id, accountId)).run();
  db.insert(balanceSnapshots)
    .values({ accountId, date: localDateString(now, timeZone), balanceCents })
    .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.date], set: { balanceCents } })
    .run();
}

function manualAccount(db: DbLike, id: string) {
  const a = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!a) throw new ManualError("not_found", "Account not found");
  if (!a.isManual)
    throw new ManualError("invalid", "That account is synced from your bank, so it can't be edited by hand");
  return a;
}

export function createManualAccount(db: DbLike, input: unknown, now: number, timeZone: string): string {
  const v = manualAccountSchema.parse(input);
  const id = `manual-${randomUUID()}`;
  db.transaction((tx) => {
    tx.insert(accounts)
      .values({
        id,
        connectionId: null,
        orgName: "Manual",
        name: v.name,
        type: v.type,
        isManual: true,
        balanceCents: v.balanceCents,
        balanceDate: now,
      })
      .run();
    writeBalance(tx, id, v.balanceCents, now, timeZone);
  });
  return id;
}

/** Sets what the account holds right now (e.g. after counting the cash). */
export function setManualBalance(
  db: DbLike,
  accountId: string,
  balanceCents: number,
  now: number,
  timeZone: string,
): void {
  const parsed = cents.parse(balanceCents);
  db.transaction((tx) => {
    manualAccount(tx, accountId);
    writeBalance(tx, accountId, parsed, now, timeZone);
  });
}

/** Deletes a manual account with all its transactions. Synced accounts can't be deleted here. */
export function deleteManualAccount(db: DbLike, accountId: string): void {
  db.transaction((tx) => {
    manualAccount(tx, accountId);
    tx.delete(accounts).where(eq(accounts.id, accountId)).run();
  });
}

function assertCategory(db: DbLike, id: number | null | undefined) {
  if (id == null) return;
  if (!db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get())
    throw new ManualError("invalid", "Unknown category");
}

const postedAt = (date: string, timeZone: string) => zonedDayStart(date, timeZone) + 12 * 3600;

/** Adds a transaction by hand; the account balance moves by its amount. */
export function createManualTransaction(
  db: DbLike,
  accountId: string,
  input: unknown,
  now: number,
  timeZone: string,
): number {
  const v = manualTransactionSchema.parse(input);
  return db.transaction((tx) => {
    const account = manualAccount(tx, accountId);
    assertCategory(tx, v.categoryId);
    const row = tx
      .insert(transactions)
      .values({
        accountId,
        sfTxnId: `manual-${randomUUID()}`,
        posted: postedAt(v.date, timeZone),
        amountCents: v.amountCents,
        description: v.description,
        categoryId: v.categoryId ?? null,
        notes: v.notes || null,
        source: "manual",
        rawJson: "{}",
        isReviewed: true,
      })
      .returning({ id: transactions.id })
      .get();
    writeBalance(tx, accountId, account.balanceCents + v.amountCents, now, timeZone);
    return row.id;
  });
}

function manualTransaction(db: DbLike, id: number) {
  const t = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!t) throw new ManualError("not_found", "Transaction not found");
  if (t.source !== "manual")
    throw new ManualError("invalid", "Only transactions you added by hand can be changed this way");
  return t;
}

export function updateManualTransaction(db: DbLike, id: number, input: unknown, now: number, timeZone: string): void {
  const v = manualTransactionPatchSchema.parse(input);
  db.transaction((tx) => {
    const t = manualTransaction(tx, id);
    assertCategory(tx, v.categoryId);
    const set: Partial<typeof transactions.$inferInsert> = {};
    if (v.date !== undefined) set.posted = postedAt(v.date, timeZone);
    if (v.amountCents !== undefined) set.amountCents = v.amountCents;
    if (v.description !== undefined) set.description = v.description;
    if (v.categoryId !== undefined) {
      set.categoryId = v.categoryId;
      tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id)).run(); // one category replaces a split
    }
    if (v.notes !== undefined) set.notes = v.notes || null;
    if (Object.keys(set).length)
      tx.update(transactions)
        .set({ ...set, updatedAt: now })
        .where(eq(transactions.id, id))
        .run();
    if (v.amountCents !== undefined && v.amountCents !== t.amountCents) {
      const account = manualAccount(tx, t.accountId);
      writeBalance(tx, t.accountId, account.balanceCents + (v.amountCents - t.amountCents), now, timeZone);
    }
  });
}

export function deleteManualTransaction(db: DbLike, id: number, now: number, timeZone: string): void {
  db.transaction((tx) => {
    const t = manualTransaction(tx, id);
    unpairTransfer(tx, id);
    const account = manualAccount(tx, t.accountId);
    tx.delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.source, "manual")))
      .run();
    writeBalance(tx, t.accountId, account.balanceCents - t.amountCents, now, timeZone);
  });
}
