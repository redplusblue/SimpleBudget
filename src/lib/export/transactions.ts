import { eq } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, categories, tags, transactionSplits, transactionTags, transactions } from "@/db/schema";
import { centsToDecimalString } from "@/lib/finance/cents";
import { localDateString } from "@/lib/finance/dates";
import { effectiveDateSql } from "@/lib/finance/sql";
import { toCsv } from "./csv";

export const EXPORT_HEADER = [
  "Date",
  "Account",
  "Payee",
  "Description",
  "Amount",
  "Category",
  "Splits",
  "Tags",
  "Notes",
  "Pending",
  "Transfer",
  "Excluded",
  "Reviewed",
  "Source",
  "ID",
];

/** Every transaction as CSV, newest first. Amounts are plain decimals (negative = money out). */
export function exportTransactionsCsv(db: DbLike, timeZone: string): string {
  const cats = new Map(
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );
  const tagNames = new Map<number, string[]>();
  for (const r of db
    .select({ id: transactionTags.transactionId, name: tags.name })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .orderBy(tags.name)
    .all()) {
    const list = tagNames.get(r.id);
    if (list) list.push(r.name);
    else tagNames.set(r.id, [r.name]);
  }
  const splits = new Map<number, string[]>();
  for (const r of db.select().from(transactionSplits).orderBy(transactionSplits.id).all()) {
    const part = `${r.categoryId === null ? "Uncategorized" : (cats.get(r.categoryId) ?? "Uncategorized")}: ${centsToDecimalString(r.amountCents)}`;
    const list = splits.get(r.transactionId);
    if (list) list.push(part);
    else splits.set(r.transactionId, [part]);
  }

  const rows = db
    .select({
      id: transactions.id,
      at: effectiveDateSql,
      account: accounts.displayName,
      accountName: accounts.name,
      payeeOverride: transactions.payeeOverride,
      payee: transactions.payee,
      description: transactions.description,
      cents: transactions.amountCents,
      categoryId: transactions.categoryId,
      notes: transactions.notes,
      pending: transactions.pending,
      transfer: transactions.isTransfer,
      excluded: transactions.isExcluded,
      reviewed: transactions.isReviewed,
      source: transactions.source,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .orderBy(effectiveDateSql, transactions.id)
    .all()
    .reverse();

  return toCsv(
    EXPORT_HEADER,
    rows.map((r) => [
      localDateString(r.at, timeZone),
      r.account?.trim() || r.accountName,
      r.payeeOverride?.trim() || r.payee?.trim() || r.description,
      r.description,
      centsToDecimalString(r.cents),
      r.categoryId === null ? "" : (cats.get(r.categoryId) ?? ""),
      (splits.get(r.id) ?? []).join("; "),
      (tagNames.get(r.id) ?? []).join("; "),
      r.notes ?? "",
      r.pending ? "yes" : "no",
      r.transfer ? "yes" : "no",
      r.excluded ? "yes" : "no",
      r.reviewed ? "yes" : "no",
      r.source,
      r.id,
    ]),
  );
}
