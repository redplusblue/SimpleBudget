import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db, DbLike } from "@/db/open";
import { accounts, balanceSnapshots, connections, holdings, syncRuns, transactions } from "@/db/schema";
import { getAccessUrl } from "@/lib/connections";
import { logger } from "@/lib/logger";
import { localDateString } from "@/lib/finance/dates";
import { guessAccountType } from "@/lib/finance/account-type";
import { detectTransfers } from "@/lib/finance/transfers";
import { fetchAccounts, SimpleFinError } from "./client";
import {
  acquireSyncLock,
  buildWindows,
  INCREMENTAL_DAYS,
  manualSyncWaitSeconds,
  markManualSync,
  recordRequest,
  releaseSyncLock,
  renewSyncLock,
  requestsRemaining,
  setSyncProgress,
  type Window,
} from "./limits";
import { notifyAfterSync } from "@/lib/notify/events";
import { parseAccount, type ParsedAccount, type ParsedHolding } from "./parse";
import { applyRulesToNew } from "@/lib/rules/store";
import { reconcilePending } from "./pending";
import type { SfAccountSet } from "./schemas";

export interface SyncOptions {
  mode?: "incremental" | "backfill";
  /** Backfill range in days (default 90, max 365). Ignored for incremental syncs (always 14). */
  days?: number;
  /** `manual` incremental syncs are subject to the 15 minute cooldown. */
  trigger?: "manual" | "scheduled";
  /** Test seams. */
  now?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeZone?: string;
}

export interface SyncResult {
  ok: true;
  runId: number;
  status: "ok" | "partial" | "error";
  requestsUsed: number;
  accountsUpdated: number;
  txnsAdded: number;
  txnsUpdated: number;
  errors: string[];
}

export interface SyncRefusal {
  ok: false;
  reason: "busy" | "no_connections" | "budget" | "throttled";
  message: string;
  retryAfterSeconds?: number;
}

interface Plan {
  mode: "incremental" | "backfill";
  windows: Window[];
  connectionIds: number[];
  now: number;
}

export const MAX_BACKFILL_DAYS = 365;

const unixNow = () => Math.floor(Date.now() / 1000);

function plan(db: Db, opts: SyncOptions, now: number): { ok: true; plan: Plan } | SyncRefusal {
  const mode = opts.mode ?? "incremental";
  const connectionIds = db
    .select({ id: connections.id })
    .from(connections)
    .orderBy(connections.id)
    .all()
    .map((c) => c.id);
  if (connectionIds.length === 0) {
    return { ok: false, reason: "no_connections", message: "No SimpleFIN connection is configured." };
  }

  if (mode === "incremental" && (opts.trigger ?? "manual") === "manual") {
    const wait = manualSyncWaitSeconds(db, now);
    if (wait > 0) {
      return {
        ok: false,
        reason: "throttled",
        message: `You can sync again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`,
        retryAfterSeconds: wait,
      };
    }
  }

  const days =
    mode === "backfill" ? Math.min(Math.max(Math.floor(opts.days ?? 90), 1), MAX_BACKFILL_DAYS) : INCREMENTAL_DAYS;
  const windows = buildWindows(now, days);
  const needed = windows.length * connectionIds.length;
  const remaining = requestsRemaining(db, now);
  if (needed > remaining) {
    return {
      ok: false,
      reason: "budget",
      message: `This sync needs ${needed} request${needed === 1 ? "" : "s"} but only ${remaining} remain today. Try again tomorrow or choose a shorter range.`,
    };
  }
  return { ok: true, plan: { mode, windows, connectionIds, now } };
}

/**
 * Starts a sync in the background. Everything that can be refused (lock, no connections,
 * cooldown, daily budget) is checked synchronously, so callers get an immediate answer.
 */
export function startSync(db: Db, opts: SyncOptions = {}): { ok: true; done: Promise<SyncResult> } | SyncRefusal {
  const now = opts.now ?? unixNow();
  if (!acquireSyncLock(db, now)) {
    return { ok: false, reason: "busy", message: "A sync is already running." };
  }
  let planned: ReturnType<typeof plan>;
  try {
    planned = plan(db, opts, now);
  } catch (err) {
    releaseSyncLock(db);
    throw err;
  }
  if (!planned.ok) {
    releaseSyncLock(db);
    return planned;
  }
  if (planned.plan.mode === "incremental" && (opts.trigger ?? "manual") === "manual") markManualSync(db, now);

  const done = execute(db, planned.plan, opts).finally(() => releaseSyncLock(db));
  // Callers that don't await (the API) must not trigger unhandled rejections; execute() never rejects anyway.
  done.catch(() => {});
  return { ok: true, done };
}

/** Records a finished, failed run for a sync that was refused (e.g. the scheduler hit the quota) so the UI shows why. */
export function recordRefusedRun(db: Db, refusal: SyncRefusal, now = unixNow()): void {
  db.insert(syncRuns)
    .values({ startedAt: now, finishedAt: now, status: "error", errorsJson: JSON.stringify([refusal.message]) })
    .run();
}

/** Runs a sync and waits for it (scheduler, tests). */
export async function runSync(db: Db, opts: SyncOptions = {}): Promise<SyncResult | SyncRefusal> {
  const started = startSync(db, opts);
  return started.ok ? started.done : started;
}

interface Stats {
  accountIds: Set<string>;
  added: number;
  updated: number;
  newIds: number[];
  skipped: number;
}

async function execute(db: Db, p: Plan, opts: SyncOptions): Promise<SyncResult> {
  const { now } = p;
  const tz = opts.timeZone ?? process.env.TZ ?? "UTC";
  const errors: string[] = [];
  const stats: Stats = { accountIds: new Set(), added: 0, updated: 0, newIds: [], skipped: 0 };
  let requestsUsed = 0;
  let successes = 0;

  // Written up front so a crash leaves a visible "did not finish" row instead of nothing.
  const run = db
    .insert(syncRuns)
    .values({ startedAt: now, status: "error", errorsJson: JSON.stringify(["Sync did not finish."]) })
    .returning({ id: syncRuns.id })
    .get();

  const total = p.windows.length * p.connectionIds.length;
  let done = 0;
  setSyncProgress(db, { done, total });

  try {
    for (const connectionId of p.connectionIds) {
      const label = `Connection ${connectionId}`;
      const connectionErrors: string[] = [];
      const accessUrl = getAccessUrl(db, connectionId);
      if (!accessUrl) {
        connectionErrors.push("Stored credentials are missing. Remove and re-add this connection.");
      } else {
        let completed = 0;
        for (const window of p.windows) {
          if (requestsRemaining(db, now) === 0) {
            connectionErrors.push("Daily SimpleFIN request limit reached.");
            break;
          }
          renewSyncLock(db, now);
          let response: SfAccountSet;
          try {
            response = await fetchAccounts({
              accessUrl,
              start: window.start,
              end: window.end,
              pending: true,
              fetchImpl: opts.fetchImpl,
              sleep: opts.sleep,
              onRequest: () => {
                requestsUsed++;
                recordRequest(db, now);
              },
            });
          } catch (err) {
            connectionErrors.push(
              err instanceof SimpleFinError ? err.message : "Unexpected error talking to SimpleFIN.",
            );
            // A failed connection won't recover within this run; don't burn more of the quota on it.
            break;
          }

          const winStats = db.transaction((tx) => applyResponse(tx, connectionId, response, window, p, tz));
          merge(stats, winStats);
          connectionErrors.push(...response.errors, ...winStats.errors);
          successes++;
          completed++;
          setSyncProgress(db, { done: ++done, total });
        }
        // Windows skipped after a failure still count as handled so the progress bar reaches 100%.
        done += p.windows.length - completed;
      }
      if (!accessUrl) done += p.windows.length;
      setSyncProgress(db, { done, total });
      // Every window of a connection repeats the same SimpleFIN errors; show each once.
      const unique = [...new Set(connectionErrors)];
      errors.push(...unique.map((e) => (p.connectionIds.length > 1 ? `${label}: ${e}` : e)));
      db.update(connections)
        .set({ lastError: unique.length ? unique.join("; ") : null })
        .where(eq(connections.id, connectionId))
        .run();
    }

    // Pairs whose halves came from different connections or windows can only be matched now.
    db.transaction((tx) => detectTransfers(tx, stats.newIds));
  } catch {
    // Deliberately not including the error: nothing here should carry credentials, but be safe.
    errors.push("Unexpected error during sync.");
  }

  const status: SyncResult["status"] = successes === 0 ? "error" : errors.length ? "partial" : "ok";
  db.update(syncRuns)
    .set({
      finishedAt: Math.max(unixNow(), now),
      status,
      requestsUsed,
      accountsUpdated: stats.accountIds.size,
      txnsAdded: stats.added,
      txnsUpdated: stats.updated,
      errorsJson: JSON.stringify(errors),
    })
    .where(eq(syncRuns.id, run.id))
    .run();

  // Optional: tell the owner about a failed sync or large new transactions (does nothing unless switched on).
  await notifyAfterSync(db, { status, errors, newIds: stats.newIds }, now, tz);

  // Optional and slow (a model call): never delays or fails the sync.
  void import("@/lib/ai/rule-runner")
    .then((m) => m.maybeSuggestRules(db, "after_sync", now, tz))
    .catch((err) => logger.warn({ err }, "rule suggestions failed"));

  return {
    ok: true,
    runId: run.id,
    status,
    requestsUsed,
    accountsUpdated: stats.accountIds.size,
    txnsAdded: stats.added,
    txnsUpdated: stats.updated,
    errors,
  };
}

function merge(into: Stats, from: Stats & { errors: string[] }) {
  from.accountIds.forEach((id) => into.accountIds.add(id));
  into.added += from.added;
  into.updated += from.updated;
  into.newIds.push(...from.newIds);
  into.skipped += from.skipped;
}

/** Applies one SimpleFIN response. Runs inside a single DB transaction. */
function applyResponse(
  db: DbLike,
  connectionId: number,
  response: SfAccountSet,
  window: Window,
  p: Plan,
  tz: string,
): Stats & { errors: string[] } {
  const { now } = p;
  const stats: Stats & { errors: string[] } = {
    accountIds: new Set(),
    added: 0,
    updated: 0,
    newIds: [],
    skipped: 0,
    errors: [],
  };
  const orgNames: string[] = [];
  let orgDomain: string | null = null;
  let orgSfinUrl: string | null = null;

  for (const raw of response.accounts) {
    let acct: ParsedAccount;
    try {
      acct = parseAccount(raw);
    } catch {
      stats.errors.push(`Skipped account "${raw.name}": its balance couldn't be read.`);
      continue;
    }
    if (acct.skippedTransactions > 0) {
      stats.skipped += acct.skippedTransactions;
      stats.errors.push(
        `Skipped ${acct.skippedTransactions} transaction(s) in "${acct.name}" with unreadable amounts.`,
      );
    }
    if (!orgNames.includes(acct.orgName)) orgNames.push(acct.orgName);
    orgDomain ??= acct.orgDomain;
    orgSfinUrl ??= acct.orgSfinUrl;

    upsertAccount(db, connectionId, acct, now);
    if (acct.holdings !== undefined) replaceHoldings(db, acct.id, acct.holdings, now);
    stats.accountIds.add(acct.id);

    db.insert(balanceSnapshots)
      .values({ accountId: acct.id, date: localDateString(now, tz), balanceCents: acct.balanceCents })
      .onConflictDoUpdate({
        target: [balanceSnapshots.accountId, balanceSnapshots.date],
        set: { balanceCents: acct.balanceCents },
      })
      .run();

    if (!acct.transactions) continue;
    const seen = new Set<string>();
    const detect: number[] = [];
    for (const t of acct.transactions) {
      seen.add(t.sfTxnId);
      const existing = db
        .select()
        .from(transactions)
        .where(and(eq(transactions.accountId, acct.id), eq(transactions.sfTxnId, t.sfTxnId)))
        .get();
      if (!existing) {
        const row = db
          .insert(transactions)
          .values({ accountId: acct.id, ...t, importedAt: now, updatedAt: now })
          .returning({ id: transactions.id })
          .get();
        stats.added++;
        detect.push(row.id);
        continue;
      }
      const changed =
        existing.posted !== t.posted ||
        existing.transactedAt !== t.transactedAt ||
        existing.pending !== t.pending ||
        existing.amountCents !== t.amountCents ||
        existing.description !== t.description ||
        existing.payee !== t.payee ||
        existing.memo !== t.memo;
      if (changed) {
        db.update(transactions)
          .set({
            posted: t.posted,
            transactedAt: t.transactedAt,
            pending: t.pending,
            amountCents: t.amountCents,
            description: t.description,
            payee: t.payee,
            memo: t.memo,
            rawJson: t.rawJson,
            updatedAt: now,
          })
          .where(eq(transactions.id, existing.id))
          .run();
        stats.updated++;
        // A pending item that just posted is effectively new for transfer matching.
        if (existing.pending && !t.pending) detect.push(existing.id);
      }
    }

    // When the bank reported problems the transaction list may be incomplete, so don't treat
    // missing pending items as gone; they're cleaned up by a later healthy sync.
    if (response.errors.length === 0) reconcilePending(db, acct.id, seen, window, now, now);

    // Rules fill in categories, tags, payees and flags for the new rows (never overwriting edits, including
    // ones just carried over from a vanished pending row), then transfer detection looks at the result.
    applyRulesToNew(db, detect);
    detectTransfers(db, detect);
    stats.newIds.push(...detect);
  }

  if (orgNames.length) {
    db.update(connections)
      .set({ orgName: orgNames.slice(0, 3).join(", "), orgDomain, sfinUrl: orgSfinUrl })
      .where(eq(connections.id, connectionId))
      .run();
  }
  return stats;
}

/** Makes the stored positions match what the bank just reported (new ones added, changed ones updated, sold ones removed). */
function replaceHoldings(db: DbLike, accountId: string, list: ParsedHolding[], now: number) {
  const keep = new Set(list.map((h) => h.sfId));
  for (const old of db
    .select({ id: holdings.id, sfId: holdings.sfId })
    .from(holdings)
    .where(eq(holdings.accountId, accountId))
    .all())
    if (!keep.has(old.sfId)) db.delete(holdings).where(eq(holdings.id, old.id)).run();
  for (const h of list) {
    const values = { ...h, accountId, updatedAt: now };
    db.insert(holdings)
      .values(values)
      .onConflictDoUpdate({ target: [holdings.accountId, holdings.sfId], set: values })
      .run();
  }
}

function upsertAccount(db: DbLike, connectionId: number, a: ParsedAccount, now: number) {
  const bank = {
    connectionId,
    orgName: a.orgName,
    name: a.name,
    currency: a.currency,
    balanceCents: a.balanceCents,
    availableCents: a.availableCents,
    balanceDate: a.balanceDate,
    updatedAt: now,
  };
  // User overlay columns (display name, type, hidden/closed, color, ...) are never in the update set.
  db.insert(accounts)
    .values({ id: a.id, ...bank, type: guessAccountType(a.name, a.orgName), createdAt: now })
    .onConflictDoUpdate({ target: accounts.id, set: bank })
    .run();
}
