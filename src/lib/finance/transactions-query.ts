import { and, desc, eq, exists, gt, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, tags, transactionTags, transactions } from "@/db/schema";
import { parseCents } from "./cents";
import { addDaysToDate, isDateString, zonedDayStart } from "./dates";
import { effectiveDateSql, expenseCondition, incomeCondition, noSplitsSql } from "./sql";
import {
  displayPayee,
  type TagChip,
  TransactionDetail,
  TransactionFilters,
  TransactionPage,
  TransactionRow,
} from "./transaction-types";

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export class InvalidCursorError extends Error {}

interface Cursor {
  pending: 0 | 1;
  date: number;
  id: number;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.pending}.${c.date}.${c.id}`).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  const m = /^([01])\.(-?\d+)\.(\d+)$/.exec(Buffer.from(raw, "base64url").toString("utf8"));
  if (!m) throw new InvalidCursorError("Invalid cursor");
  return { pending: Number(m[1]) as 0 | 1, date: Number(m[2]), id: Number(m[3]) };
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function searchCondition(q: string): SQL | undefined {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (terms.length === 0) return undefined;
  const haystack = sql`lower(${transactions.description} || ' ' || coalesce(${transactions.payee}, '') || ' ' || coalesce(${transactions.payeeOverride}, '') || ' ' || coalesce(${transactions.memo}, '') || ' ' || coalesce(${transactions.notes}, ''))`;
  return and(
    ...terms.map((term) => {
      const text = sql`${haystack} LIKE ${`%${likeEscape(term)}%`} ESCAPE '\\'`;
      // A term that looks like an amount ("42.18") also matches the transaction's amount.
      if (/^\$?\d+(\.\d{1,2})?$/.test(term)) {
        const cents = parseCents(term.replace("$", ""));
        return or(text, sql`abs(${transactions.amountCents}) = ${cents}`);
      }
      return text;
    }),
  );
}

/** Builds the WHERE conditions shared by the page query and the count. */
export function buildConditions(filters: TransactionFilters, timeZone: string): SQL[] {
  const c: (SQL | undefined)[] = [];
  if (filters.accountId) c.push(eq(transactions.accountId, filters.accountId));
  if (filters.q) c.push(searchCondition(filters.q));
  if (filters.from && isDateString(filters.from))
    c.push(sql`${effectiveDateSql} >= ${zonedDayStart(filters.from, timeZone)}`);
  if (filters.to && isDateString(filters.to)) {
    c.push(sql`${effectiveDateSql} < ${zonedDayStart(addDaysToDate(filters.to, 1), timeZone)}`);
  }
  if (filters.merchant) c.push(eq(transactions.merchantKey, filters.merchant));
  if (filters.categoryId === "none")
    c.push(
      and(
        isNull(transactions.categoryId),
        or(
          noSplitsSql,
          sql`EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = ${transactions.id} AND sp.category_id IS NULL)`,
        ),
      )!,
    );
  else if (typeof filters.categoryId === "number")
    c.push(
      or(
        eq(transactions.categoryId, filters.categoryId),
        sql`EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = ${transactions.id} AND sp.category_id = ${filters.categoryId})`,
      )!,
    );
  if (filters.tagId !== undefined) {
    c.push(
      exists(
        sql`(select 1 from ${transactionTags} tt where tt.transaction_id = ${transactions.id} and tt.tag_id = ${filters.tagId})`,
      ),
    );
  }
  if (filters.minAmountCents !== undefined) c.push(sql`abs(${transactions.amountCents}) >= ${filters.minAmountCents}`);
  if (filters.maxAmountCents !== undefined) c.push(sql`abs(${transactions.amountCents}) <= ${filters.maxAmountCents}`);

  switch (filters.type) {
    case "expense":
      c.push(expenseCondition);
      break;
    case "income":
      c.push(incomeCondition);
      break;
    case "transfer":
      c.push(eq(transactions.isTransfer, true));
      break;
  }
  if (filters.status === "pending") c.push(eq(transactions.pending, true));
  else if (filters.status === "unreviewed") c.push(eq(transactions.isReviewed, false));
  else if (filters.status === "reviewed") c.push(eq(transactions.isReviewed, true));
  return c.filter((x): x is SQL => x !== undefined);
}

/** True when anything besides the account is filtered; running balances are only valid when it isn't. */
function hasNonAccountFilter(f: TransactionFilters): boolean {
  const { accountId: _accountId, ...rest } = f;
  void _accountId;
  return Object.values(rest).some((v) => v !== undefined && v !== "");
}

const rowSelect = {
  id: transactions.id,
  accountId: transactions.accountId,
  accountName: sql<string>`coalesce(${accounts.displayName}, ${accounts.name})`,
  currency: accounts.currency,
  effectiveDate: effectiveDateSql,
  posted: transactions.posted,
  transactedAt: transactions.transactedAt,
  pending: transactions.pending,
  amountCents: transactions.amountCents,
  description: transactions.description,
  payee: transactions.payee,
  memo: transactions.memo,
  payeeOverride: transactions.payeeOverride,
  categoryId: transactions.categoryId,
  splitCount: sql<number>`(SELECT count(*) FROM transaction_splits sp WHERE sp.transaction_id = ${transactions.id})`,
  notes: transactions.notes,
  isTransfer: transactions.isTransfer,
  transferPairId: transactions.transferPairId,
  isExcluded: transactions.isExcluded,
  isReviewed: transactions.isReviewed,
};

type SelectedRow = Omit<TransactionRow, "displayPayee" | "tags" | "runningBalanceCents">;

function loadTags(db: DbLike, ids: number[]): Map<number, TagChip[]> {
  const map = new Map<number, TagChip[]>();
  if (ids.length === 0) return map;
  const rows = db
    .select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name, color: tags.color })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(inArray(transactionTags.transactionId, ids))
    .orderBy(tags.name)
    .all();
  for (const r of rows) {
    const list = map.get(r.transactionId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.transactionId, list);
  }
  return map;
}

function toRows(db: DbLike, selected: SelectedRow[]): TransactionRow[] {
  const tagMap = loadTags(
    db,
    selected.map((r) => r.id),
  );
  return selected.map((r) => ({
    ...r,
    displayPayee: displayPayee(r),
    tags: tagMap.get(r.id) ?? [],
    runningBalanceCents: null,
  }));
}

export interface QueryOptions {
  cursor?: string | null;
  limit?: number;
  timeZone: string;
  /** Skip the (first page) COUNT query when the caller doesn't need it. */
  includeTotal?: boolean;
}

/**
 * Pages through transactions newest first, with pending items on top. The cursor encodes
 * (pending, date, id), which is the exact sort key, so paging is stable while data changes.
 */
export function queryTransactions(db: DbLike, filters: TransactionFilters, opts: QueryOptions): TransactionPage {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const base = buildConditions(filters, opts.timeZone);

  const where = [...base];
  if (opts.cursor) {
    const cur = decodeCursor(opts.cursor);
    where.push(
      or(
        sql`${transactions.pending} < ${cur.pending}`,
        and(
          sql`${transactions.pending} = ${cur.pending}`,
          or(
            sql`${effectiveDateSql} < ${cur.date}`,
            and(sql`${effectiveDateSql} = ${cur.date}`, lt(transactions.id, cur.id)),
          ),
        ),
      )!,
    );
  }

  const selected = db
    .select(rowSelect)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...where))
    .orderBy(desc(transactions.pending), desc(effectiveDateSql), desc(transactions.id))
    .limit(limit + 1)
    .all() as SelectedRow[];

  const hasMore = selected.length > limit;
  const pageRows = toRows(db, hasMore ? selected.slice(0, limit) : selected);

  if (filters.accountId && !hasNonAccountFilter(filters)) applyRunningBalance(db, filters.accountId, pageRows);

  const last = pageRows[pageRows.length - 1];
  const page: TransactionPage = {
    rows: pageRows,
    nextCursor:
      hasMore && last ? encodeCursor({ pending: last.pending ? 1 : 0, date: last.effectiveDate, id: last.id }) : null,
  };
  if (!opts.cursor && opts.includeTotal !== false) {
    page.total =
      db
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(and(...base))
        .get()?.n ?? 0;
  }
  return page;
}

/**
 * Fills `runningBalanceCents` for posted rows by working backwards from the account's current balance:
 * a row's balance is the bank balance minus everything posted after it. Pending rows get none because
 * banks don't include them in the balance.
 */
function applyRunningBalance(db: DbLike, accountId: string, rows: TransactionRow[]): void {
  const first = rows.find((r) => !r.pending);
  if (!first) return;
  const account = db.select({ balance: accounts.balanceCents }).from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return;
  const newer =
    db
      .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.pending, false),
          or(
            gt(transactions.posted, first.posted),
            and(eq(transactions.posted, first.posted), gt(transactions.id, first.id)),
          ),
        ),
      )
      .get()?.total ?? 0;
  let running = account.balance - newer;
  for (const r of rows) {
    if (r.pending) continue;
    r.runningBalanceCents = running;
    running -= r.amountCents;
  }
}

/** Rows for specific ids, in the order given (missing ids are skipped). No running balances. */
export function getTransactionRows(db: DbLike, ids: number[]): TransactionRow[] {
  if (ids.length === 0) return [];
  const selected = db
    .select(rowSelect)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(inArray(transactions.id, ids))
    .all() as SelectedRow[];
  const byId = new Map(toRows(db, selected).map((r) => [r.id, r]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export function getTransactionDetail(db: DbLike, id: number): TransactionDetail | undefined {
  const selected = db
    .select({ ...rowSelect, rawJson: transactions.rawJson, importedAt: transactions.importedAt })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(eq(transactions.id, id))
    .get();
  if (!selected) return undefined;
  const { rawJson, importedAt, ...rest } = selected as SelectedRow & { rawJson: string; importedAt: number };
  const [row] = toRows(db, [rest]);

  let pair: TransactionDetail["pair"] = null;
  if (row.transferPairId) {
    const p = db
      .select(rowSelect)
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(eq(transactions.id, row.transferPairId), ne(transactions.id, row.id)))
      .get() as SelectedRow | undefined;
    if (p) {
      pair = {
        id: p.id,
        accountName: p.accountName,
        displayPayee: displayPayee(p),
        amountCents: p.amountCents,
        currency: p.currency,
        effectiveDate: p.effectiveDate,
      };
    }
  }
  return { ...row, rawJson, importedAt, pair };
}
