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

export type ExportFormat = "csv" | "tsv" | "txt" | "json";
export const EXPORT_FORMATS: ExportFormat[] = ["csv", "tsv", "txt", "json"];

/** Every transaction as export cells (header excluded), newest first. Amounts are plain decimals (negative = money out). */
function exportRows(db: DbLike, timeZone: string): string[][] {
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

  return rows.map((r) => [
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
    String(r.id),
  ]);
}

/** Every transaction as CSV, newest first. */
export function exportTransactionsCsv(db: DbLike, timeZone: string): string {
  return toCsv(EXPORT_HEADER, exportRows(db, timeZone));
}

const clean = (v: string) => v.replace(/[\t\r\n]+/g, " ").trim();

/** Tab-separated: one line per transaction, tabs/newlines inside cells flattened to spaces. */
export function exportTransactionsTsv(db: DbLike, timeZone: string): string {
  return [EXPORT_HEADER, ...exportRows(db, timeZone)].map((r) => r.map(clean).join("\t")).join("\n") + "\n";
}

/** Plain text: aligned columns, one transaction per line, the fields you read at a glance (the CSV has the rest). */
export function exportTransactionsTxt(db: DbLike, timeZone: string): string {
  // Date, Account, Payee, Amount, Category, Notes
  const pick = (r: string[]) => [r[0], r[1], r[2], r[4], r[5] || (r[6] ? "Split" : ""), r[8]].map(clean);
  const lines = [["Date", "Account", "Payee", "Amount", "Category", "Notes"], ...exportRows(db, timeZone).map(pick)];
  const widths = [0, 1, 2, 3, 4].map((i) => Math.min(40, Math.max(...lines.map((l) => l[i].length))));
  const fit = (v: string, w: number) => (v.length > w ? `${v.slice(0, w - 1)}…` : v);
  return (
    lines
      .map((l) =>
        l
          .map((v, i) =>
            i === 3 ? fit(v, widths[i]).padStart(widths[i]) : i < 5 ? fit(v, widths[i]).padEnd(widths[i]) : v,
          )
          .join("  ")
          .trimEnd(),
      )
      .join("\n") + "\n"
  );
}

/** JSON array of objects keyed by the CSV header names. */
export function exportTransactionsJson(db: DbLike, timeZone: string): string {
  const out = exportRows(db, timeZone).map((r) => Object.fromEntries(EXPORT_HEADER.map((h, i) => [h, r[i]])));
  return JSON.stringify(out, null, 2) + "\n";
}

export const EXPORT_TYPES: Record<
  ExportFormat,
  { mime: string; build: (db: DbLike, tz: string) => string; bom: boolean }
> = {
  csv: { mime: "text/csv", build: exportTransactionsCsv, bom: true },
  tsv: { mime: "text/tab-separated-values", build: exportTransactionsTsv, bom: true },
  txt: { mime: "text/plain", build: exportTransactionsTxt, bom: true },
  json: { mime: "application/json", build: exportTransactionsJson, bom: false },
};
