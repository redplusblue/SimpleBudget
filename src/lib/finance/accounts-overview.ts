import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, balanceSnapshots, transactions } from "@/db/schema";
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_GROUP_ORDER,
  groupKeyFor,
  type AccountGroupKey,
  type AccountType,
} from "./account-types";
import { addDaysToDate, currentMonth, DAY, localDateString, monthRange } from "./dates";

export const STALE_AFTER_SECONDS = 3 * DAY;
export const SPARKLINE_DAYS = 30;
export const CHART_DAYS = 90;

export interface AccountSummary {
  id: string;
  orgName: string;
  name: string;
  displayName: string | null;
  /** Display name when set, else the bank's name. */
  label: string;
  currency: string;
  type: AccountType;
  balanceCents: number;
  availableCents: number | null;
  balanceDate: number | null;
  isHidden: boolean;
  isClosed: boolean;
  excludeFromNetWorth: boolean;
  color: string | null;
  /** An offline account the user keeps by hand; it is never synced, so it is never "stale". */
  isManual: boolean;
  creditLimitCents: number | null;
  lowBalanceCents: number | null;
  /** Balance hasn't been refreshed by the bank in over 3 days. */
  stale: boolean;
}

export interface BalancePoint {
  date: string;
  balanceCents: number;
}

export interface AccountOverviewItem extends AccountSummary {
  sparkline: number[];
}

export interface AccountGroup {
  key: AccountGroupKey;
  label: string;
  totalCents: number;
  accounts: AccountOverviewItem[];
}

function toSummary(a: typeof accounts.$inferSelect, now: number): AccountSummary {
  return {
    id: a.id,
    orgName: a.orgName,
    name: a.name,
    displayName: a.displayName,
    label: a.displayName?.trim() || a.name,
    currency: a.currency,
    type: a.type,
    balanceCents: a.balanceCents,
    availableCents: a.availableCents,
    balanceDate: a.balanceDate,
    isHidden: a.isHidden,
    isClosed: a.isClosed,
    excludeFromNetWorth: a.excludeFromNetWorth,
    creditLimitCents: a.creditLimitCents,
    lowBalanceCents: a.lowBalanceCents,
    color: a.color,
    isManual: a.isManual,
    stale: !a.isManual && (a.balanceDate === null || now - a.balanceDate > STALE_AFTER_SECONDS),
  };
}

/**
 * Daily balances for the last `days` local days, ending today. Days with no snapshot carry the previous
 * balance forward; days before the account's first known balance are omitted (no fake zeros).
 */
export function balanceSeries(
  db: DbLike,
  accountId: string,
  days: number,
  now: number,
  timeZone: string,
): BalancePoint[] {
  const today = localDateString(now, timeZone);
  const start = addDaysToDate(today, -(days - 1));
  const rows = db
    .select({ date: balanceSnapshots.date, balance: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), gte(balanceSnapshots.date, start)))
    .orderBy(balanceSnapshots.date)
    .all();
  const prior = db
    .select({ balance: balanceSnapshots.balanceCents })
    .from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, accountId), lt(balanceSnapshots.date, start)))
    .orderBy(desc(balanceSnapshots.date))
    .limit(1)
    .get();
  const byDate = new Map(rows.map((r) => [r.date, r.balance]));
  let current = prior?.balance;
  const out: BalancePoint[] = [];
  for (let d = start; d <= today; d = addDaysToDate(d, 1)) {
    const v = byDate.get(d);
    if (v !== undefined) current = v;
    if (current !== undefined) out.push({ date: d, balanceCents: current });
  }
  return out;
}

/** Accounts grouped for the overview page. Hidden accounts are left out unless asked for. */
export function getAccountsOverview(db: DbLike, now: number, timeZone: string, includeHidden = false): AccountGroup[] {
  const rows = db.select().from(accounts).orderBy(accounts.sortOrder, accounts.orgName, accounts.name).all();
  const groups = new Map<AccountGroupKey, AccountGroup>();
  for (const row of rows) {
    if (row.isHidden && !includeHidden) continue;
    const key = groupKeyFor(row.type, row.isClosed);
    const group = groups.get(key) ?? { key, label: ACCOUNT_GROUP_LABELS[key], totalCents: 0, accounts: [] };
    group.accounts.push({
      ...toSummary(row, now),
      sparkline: balanceSeries(db, row.id, SPARKLINE_DAYS, now, timeZone).map((p) => p.balanceCents),
    });
    group.totalCents += row.balanceCents;
    groups.set(key, group);
  }
  return ACCOUNT_GROUP_ORDER.flatMap((k) => groups.get(k) ?? []);
}

export interface MonthStats {
  month: string;
  /** Money in/out of the account over the month, excluding transactions flagged "exclude from stats". */
  inCents: number;
  outCents: number;
  netCents: number;
}

/** Posted money in/out for one account in a local month. Pending items aren't in the balance yet, so they're skipped. */
export function accountMonthStats(db: DbLike, accountId: string, month: string, timeZone: string): MonthStats {
  const { start, end } = monthRange(month, timeZone);
  const r = db
    .select({
      inCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} > 0 then ${transactions.amountCents} else 0 end), 0)`,
      outCents: sql<number>`coalesce(sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.pending, false),
        eq(transactions.isExcluded, false),
        gte(transactions.posted, start),
        lt(transactions.posted, end),
      ),
    )
    .get();
  const inCents = r?.inCents ?? 0;
  const outCents = r?.outCents ?? 0;
  return { month, inCents, outCents, netCents: inCents - outCents };
}

export interface AccountDetail {
  account: AccountSummary;
  stats: MonthStats;
  series: BalancePoint[];
}

export function getAccountDetail(db: DbLike, id: string, now: number, timeZone: string): AccountDetail | undefined {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!row) return undefined;
  return {
    account: toSummary(row, now),
    stats: accountMonthStats(db, id, currentMonth(now, timeZone), timeZone),
    series: balanceSeries(db, id, CHART_DAYS, now, timeZone),
  };
}
