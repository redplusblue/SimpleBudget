import "server-only";
import { and, count, eq, inArray, max } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { categories, transactionSplits, transactions } from "@/db/schema";
import { currentMonth, localDateString, shiftMonth } from "./dates";
import { normalizePayee } from "./payee";
import { detectCadence, INCREASE_THRESHOLD, nextDate } from "./recurring";
import { merchantName } from "./spending-report";
import { effectiveDateSql } from "./sql";
import type { TraceReport, TraceRef } from "./trace-types";
import { getTransactionDetail } from "./transactions-query";
import { planForTransaction } from "@/lib/rules/engine";
import { listRules, loadTargets } from "@/lib/rules/store";

const DAY = 86_400;
const SIMILAR_AMOUNT = 0.1;
/** Charges within this band of the typical amount count as the same subscription when looking for price steps. */
const PRICE_BAND = 0.35;
const REFUND_DAYS = 60;
const DUPLICATE_SECONDS = 48 * 3600;
const MIN_PREFIX_KEY = 5;
const MIN_FIRST_WORD = 4;

const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface Row {
  id: number;
  cents: number;
  at: number;
  date: string;
  categoryId: number | null;
}

/** Other merchant keys that look like the same business: one key extends the other, or the first words match. */
export function similarMerchants(
  db: DbLike,
  key: string,
  name: string,
): Array<{ key: string; name: string; count: number }> {
  const firstWord = (n: string) => (normalizePayee(n).split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const mine = firstWord(name);
  const rows = db
    .select({
      key: transactions.merchantKey,
      n: count(),
      latest: max(transactions.id),
      description: transactions.description,
      payee: transactions.payee,
      payeeOverride: transactions.payeeOverride,
    })
    .from(transactions)
    .groupBy(transactions.merchantKey)
    .all();
  return rows
    .flatMap((r) => {
      if (!r.key || r.key === key) return [];
      const [short, long] = key.length <= r.key.length ? [key, r.key] : [r.key, key];
      const byKey = short.length >= MIN_PREFIX_KEY && long.startsWith(short);
      const theirName = normalizePayee(r.payeeOverride?.trim() || r.payee?.trim() || r.description) || r.key;
      const theirs = firstWord(theirName);
      const byWord = mine.length >= MIN_FIRST_WORD && theirs === mine;
      return byKey || byWord ? [{ key: r.key, name: theirName, count: r.n }] : [];
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 5);
}

/** Everything the app knows about one merchant, for one transaction. Pure statistics: no model involved. */
export function traceTransaction(db: DbLike, id: number, now: number, timeZone: string): TraceReport | undefined {
  const detail = getTransactionDetail(db, id, timeZone);
  if (!detail) return undefined;
  const key =
    db.select({ k: transactions.merchantKey }).from(transactions).where(eq(transactions.id, id)).get()?.k ?? null;

  const toRow = (r: { id: number; cents: number; at: number; categoryId: number | null }): Row => ({
    ...r,
    date: localDateString(r.at, timeZone),
  });
  const rows: Row[] = key
    ? db
        .select({
          id: transactions.id,
          cents: transactions.amountCents,
          at: effectiveDateSql,
          categoryId: transactions.categoryId,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.merchantKey, key),
            eq(transactions.isExcluded, false),
            eq(transactions.isTransfer, false),
          ),
        )
        .all()
        .map(toRow)
    : [];
  // A transfer or excluded row (or one with no merchant key) is still the subject of its own trace.
  const self = toRow({ id, cents: detail.amountCents, at: detail.effectiveDate, categoryId: detail.categoryId });
  if (!rows.some((r) => r.id === id)) rows.push(self);
  rows.sort((a, b) => a.at - b.at || a.id - b.id);

  const expenses = rows.filter((r) => r.cents < 0);
  const incomes = rows.filter((r) => r.cents > 0);
  const abs = (r: Row) => Math.abs(r.cents);
  const expenseAmounts = expenses.map(abs);

  // ── stats ──
  const thisMonth = currentMonth(now, timeZone);
  const since = shiftMonth(thisMonth, -11);
  const recent = expenses.filter((r) => r.date.slice(0, 7) >= since);
  const activeMonths = new Set(recent.map((r) => r.date.slice(0, 7))).size;
  const last12 = recent.reduce((s, r) => s + abs(r), 0);
  const name = key ? merchantName(db, key) : normalizePayee(detail.displayPayee) || detail.displayPayee;

  // ── position among the merchant's rows of the same direction ──
  const same = self.cents < 0 ? expenses : incomes;
  const mine = Math.abs(self.cents);
  const sameAbs = same.map(abs);
  const typical = median(sameAbs);
  const position = {
    percentile: same.length ? Math.round((100 * sameAbs.filter((a) => a < mine).length) / same.length) : 0,
    vsMedianPct: typical > 0 ? Math.round(((mine - typical) / typical) * 100) : null,
    isLargest: same.length > 1 && mine >= Math.max(...sameAbs),
    isFirst: rows[0].id === id,
  };

  // ── cadence: charges within ±10% of this one ──
  let cadence: TraceReport["cadence"] = null;
  if (self.cents < 0) {
    const similar = expenses.filter((r) => Math.abs(abs(r) - mine) <= SIMILAR_AMOUNT * mine);
    const intervals = similar.slice(1).map((r, i) => utcDay(r.date) - utcDay(similar[i].date));
    const found = detectCadence(intervals);
    if (found)
      cadence = { cadence: found.cadence, nextExpected: nextDate(similar[similar.length - 1].date, found.cadence) };
  }

  // ── lasting price steps ──
  const priceChanges: TraceReport["priceChanges"] = [];
  const typicalExpense = median(expenseAmounts);
  const series = expenses.filter(
    (r) => typicalExpense > 0 && Math.abs(abs(r) - typicalExpense) <= PRICE_BAND * typicalExpense,
  );
  if (series.length >= 2) {
    let level = abs(series[0]);
    series.slice(1).forEach((r, i) => {
      const a = abs(r);
      if (Math.abs(a - level) / level < INCREASE_THRESHOLD) return;
      const next = series[i + 2];
      // A one-off blip (the next charge is back at the old level) isn't a price change.
      if (next && Math.abs(abs(next) - a) / a >= INCREASE_THRESHOLD) return;
      priceChanges.push({ date: r.date, fromCents: level, toCents: a });
      level = a;
    });
  }

  // ── last 24 months ──
  const byMonth = Array.from({ length: 24 }, (_, i) => {
    const month = shiftMonth(thisMonth, -i);
    const inMonth = expenses.filter((r) => r.date.slice(0, 7) === month);
    return { month, spentCents: inMonth.reduce((s, r) => s + abs(r), 0), count: inMonth.length };
  });

  // ── related ──
  const ref = (r: Row): TraceRef => ({ id: r.id, date: r.date, amountCents: r.cents });
  const refunds =
    self.cents < 0
      ? incomes.filter((r) => r.at >= self.at && r.at <= self.at + REFUND_DAYS * DAY && r.cents <= mine).map(ref)
      : [];
  const possibleDuplicates = rows
    .filter((r) => r.id !== id && r.cents === self.cents && Math.abs(r.at - self.at) <= DUPLICATE_SECONDS)
    .map(ref);

  // ── categories (split rows count by their parts) ──
  const splitIds = rows.map((r) => r.id);
  const parts = splitIds.length
    ? db
        .select({ transactionId: transactionSplits.transactionId, categoryId: transactionSplits.categoryId })
        .from(transactionSplits)
        .where(inArray(transactionSplits.transactionId, splitIds))
        .all()
    : [];
  const split = new Set(parts.map((p) => p.transactionId));
  const names = new Map(
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );
  const tally = new Map<string, number>();
  const bump = (categoryId: number | null) => {
    const label = categoryId === null ? "Uncategorized" : (names.get(categoryId) ?? "Uncategorized");
    tally.set(label, (tally.get(label) ?? 0) + 1);
  };
  for (const r of rows) if (!split.has(r.id)) bump(r.categoryId);
  for (const p of parts) bump(p.categoryId);

  // ── the rule that covers it ──
  const [target] = loadTargets(db, [id]);
  const rules = listRules(db).filter((r) => r.enabled);
  const plan = target ? planForTransaction(rules, target.target, { overwrite: true }) : null;
  const matchedRules = (plan?.matched ?? []).map((rid) => rules.find((r) => r.id === rid)!);
  const covering = matchedRules.find((r) => r.actions.categoryId !== undefined) ?? matchedRules[0];

  return {
    transactionId: id,
    merchant: { key, name },
    stats: {
      count: rows.length,
      firstDate: rows[0].date,
      lastDate: rows[rows.length - 1].date,
      totalSpentCents: expenseAmounts.reduce((s, v) => s + v, 0),
      totalReceivedCents: incomes.reduce((s, r) => s + r.cents, 0),
      medianCents: Math.round(median(expenseAmounts)),
      minCents: expenseAmounts.length ? Math.min(...expenseAmounts) : 0,
      maxCents: expenseAmounts.length ? Math.max(...expenseAmounts) : 0,
      last12MonthsSpentCents: last12,
      averageMonthlyCents: activeMonths ? Math.round(last12 / activeMonths) : 0,
    },
    position,
    cadence,
    priceChanges,
    byMonth,
    related: {
      refunds,
      possibleDuplicates,
      transferPair: detail.pair ? { id: detail.pair.id } : null,
    },
    similarMerchants: key ? similarMerchants(db, key, name) : [],
    categories: [...tally.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    rule: covering ? { id: covering.id, name: covering.name } : null,
  };
}
