import { and, asc, inArray, lte, min, sql, type AnyColumn } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, balanceSnapshots } from "@/db/schema";
import type { BalancePoint } from "./accounts-overview";
import { convertCents, foreignCurrencies, getRates, scaleFor } from "./currency";
import { addDaysToDate, localDateString } from "./dates";

export const NET_WORTH_RANGES = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, ALL: null } as const;
export type NetWorthRange = keyof typeof NET_WORTH_RANGES;
export const DEFAULT_NET_WORTH_RANGE: NetWorthRange = "3M";
export const CHANGE_WINDOW_DAYS = 30;

export interface NetWorthSummary {
  /** Sum of all counted balances right now (credit cards and loans are negative). */
  totalCents: number;
  assetsCents: number;
  /** Positive number: how much is owed. */
  liabilitiesCents: number;
  accountCount: number;
  changeCents: number | null;
  changePct: number | null;
  /** The date the change is measured from: 30 days ago, or the first day we have data for. */
  baselineDate: string | null;
  baselineKind: "30d" | "first" | null;
  range: NetWorthRange;
  /** Accounts in other currencies are included at these rates (1 unit = `rate` dollars; null = no rate set, counted 1 to 1). */
  converted: Array<{ currency: string; rate: number | null }>;
  series: BalancePoint[];
}

const isFalse = (col: AnyColumn) => sql`${col} = 0`;

/**
 * Accounts counted toward net worth. Hidden accounts are left out along with ones the user excluded:
 * a hidden account disappears from every list, so it shouldn't silently move the total either.
 */
function countedAccounts(db: DbLike) {
  const rates = getRates(db);
  return db
    .select({ id: accounts.id, balanceCents: accounts.balanceCents, currency: accounts.currency })
    .from(accounts)
    .where(and(isFalse(accounts.excludeFromNetWorth), isFalse(accounts.isHidden)))
    .all()
    .map((a) => ({ id: a.id, balanceCents: convertCents(a.balanceCents, a.currency, rates) }));
}

/**
 * Daily net worth from `start` to `end` (inclusive local dates). Each account contributes its latest
 * known balance on or before the day (carried forward over gaps), and nothing before its first snapshot,
 * so adding an account mid-history never makes earlier days drop to zero. Days where no account has any
 * data are omitted.
 */
export function netWorthBetween(db: DbLike, ids: string[], start: string, end: string): BalancePoint[] {
  if (ids.length === 0) return [];
  const rows = db
    .select({ id: balanceSnapshots.accountId, date: balanceSnapshots.date, balance: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(inArray(balanceSnapshots.accountId, ids), lte(balanceSnapshots.date, end)))
    .orderBy(asc(balanceSnapshots.date))
    .all();
  const scale = scaleFor(db, ids); // accounts in other currencies are converted at your rates
  const byAccount = new Map<string, Array<{ date: string; balance: number }>>();
  for (const r of rows) {
    const list = byAccount.get(r.id) ?? [];
    list.push({ date: r.date, balance: scale?.has(r.id) ? Math.round(r.balance * scale.get(r.id)!) : r.balance });
    byAccount.set(r.id, list);
  }

  const cursors = [...byAccount.values()].map((list) => ({ list, i: -1, value: undefined as number | undefined }));
  // Fast-forward each account to the last snapshot before the window.
  for (const c of cursors) {
    while (c.i + 1 < c.list.length && c.list[c.i + 1].date < start) c.i++;
    if (c.i >= 0) c.value = c.list[c.i].balance;
  }

  const points: BalancePoint[] = [];
  for (let d = start; d <= end; d = addDaysToDate(d, 1)) {
    let total = 0;
    let any = false;
    for (const c of cursors) {
      while (c.i + 1 < c.list.length && c.list[c.i + 1].date <= d) {
        c.i++;
        c.value = c.list[c.i].balance;
      }
      if (c.value !== undefined) {
        total += c.value;
        any = true;
      }
    }
    if (any) points.push({ date: d, balanceCents: total });
  }
  return points;
}

/** The range's series with today's point replaced by the live balances so it matches the account list. */
export function getNetWorthSeries(db: DbLike, range: NetWorthRange, now: number, timeZone: string): BalancePoint[] {
  const counted = countedAccounts(db);
  const ids = counted.map((a) => a.id);
  const today = localDateString(now, timeZone);
  const days = NET_WORTH_RANGES[range];
  let start: string;
  if (days !== null) start = addDaysToDate(today, -(days - 1));
  else {
    const first = ids.length
      ? db
          .select({ d: min(balanceSnapshots.date) })
          .from(balanceSnapshots)
          .where(inArray(balanceSnapshots.accountId, ids))
          .get()?.d
      : null;
    start = first ?? today;
  }
  const series = netWorthBetween(db, ids, start, today);
  const live = counted.reduce((s, a) => s + a.balanceCents, 0);
  if (counted.length === 0) return series;
  const last = series[series.length - 1];
  if (last?.date === today) last.balanceCents = live;
  else series.push({ date: today, balanceCents: live });
  return series;
}

export function getNetWorthSummary(db: DbLike, range: NetWorthRange, now: number, timeZone: string): NetWorthSummary {
  const counted = countedAccounts(db);
  const totalCents = counted.reduce((s, a) => s + a.balanceCents, 0);
  const assetsCents = counted.reduce((s, a) => s + Math.max(a.balanceCents, 0), 0);
  const liabilitiesCents = counted.reduce((s, a) => s + Math.max(-a.balanceCents, 0), 0);

  const today = localDateString(now, timeZone);
  const baselineTarget = addDaysToDate(today, -CHANGE_WINDOW_DAYS);
  // Always measure against the last 30 days, whatever range the chart shows.
  const recent = netWorthBetween(
    db,
    counted.map((a) => a.id),
    baselineTarget,
    today,
  );
  let changeCents: number | null = null;
  let changePct: number | null = null;
  let baselineDate: string | null = null;
  let baselineKind: NetWorthSummary["baselineKind"] = null;
  if (recent.length >= 2) {
    const base = recent[0];
    changeCents = totalCents - base.balanceCents;
    changePct = base.balanceCents === 0 ? null : changeCents / Math.abs(base.balanceCents);
    baselineDate = base.date;
    baselineKind = base.date === baselineTarget ? "30d" : "first";
  }

  return {
    totalCents,
    assetsCents,
    liabilitiesCents,
    accountCount: counted.length,
    changeCents,
    changePct,
    baselineDate,
    baselineKind,
    range,
    converted: counted.length === 0 ? [] : foreignCurrencies(db).map((c) => ({ currency: c.currency, rate: c.rate })),
    series: getNetWorthSeries(db, range, now, timeZone),
  };
}
