import "server-only";
import { desc, eq, gte, inArray } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, categories, transactions } from "@/db/schema";
import { currentMonth, localDateString } from "@/lib/finance/dates";
import { effectiveDateSql } from "@/lib/finance/sql";
import { getTargetProgress } from "@/lib/finance/targets";
import { logger } from "@/lib/logger";
import { ruleMatches } from "@/lib/rules/engine";
import { loadTargets } from "@/lib/rules/store";
import { runAutomation, type RunContext, type RunOutcome, type TxnLite } from "./run";
import { getAutomation, listAutomations } from "./store";
import type { AutomationView } from "./types";

type Deps = RunContext["deps"];

/** The few fields of these transactions that messages may use, newest first. */
export function loadTxnLite(db: DbLike, ids: number[], timeZone: string): TxnLite[] {
  if (ids.length === 0) return [];
  const names = new Map(
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );
  return db
    .select({
      id: transactions.id,
      at: effectiveDateSql,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      payeeOverride: transactions.payeeOverride,
      payee: transactions.payee,
      description: transactions.description,
      account: accounts.displayName,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(inArray(transactions.id, ids))
    .orderBy(desc(effectiveDateSql), desc(transactions.id))
    .all()
    .map((r) => ({
      id: r.id,
      date: localDateString(r.at, timeZone),
      payee: r.payeeOverride?.trim() || r.payee?.trim() || r.description,
      amountCents: r.amountCents,
      category: r.categoryId === null ? "Uncategorized" : (names.get(r.categoryId) ?? "Uncategorized"),
      account: r.account || r.accountName,
    }));
}

/** Of `ids`, the transactions a transaction trigger matches (no transfers or excluded rows; pending only if asked). */
export function matchingTransactionIds(db: DbLike, a: AutomationView, ids: number[]): number[] {
  const t = a.trigger;
  if (t.type !== "transaction" || ids.length === 0) return [];
  const pending = new Map(
    db
      .select({ id: transactions.id, pending: transactions.pending })
      .from(transactions)
      .where(inArray(transactions.id, ids))
      .all()
      .map((r) => [r.id, r.pending]),
  );
  return loadTargets(db, ids)
    .map((l) => l.target)
    .filter((x) => !x.isExcluded && !x.isTransfer)
    .filter((x) => t.includePending || !pending.get(x.id))
    .filter((x) => ruleMatches({ match: t.match, conditions: t.conditions }, x))
    .map((x) => x.id);
}

/**
 * Called after a sync: transaction triggers run once with everything new that matches; target and balance triggers
 * fire once per category and month, or once per account and day. Never throws.
 */
export async function runAutomationsAfterSync(
  db: DbLike,
  sync: { newIds: number[] },
  now: number,
  timeZone: string,
  deps?: Deps,
): Promise<void> {
  try {
    const month = currentMonth(now, timeZone);
    const today = localDateString(now, timeZone);
    for (const a of listAutomations(db).filter((x) => x.enabled)) {
      const base = { now, timeZone, trigger: "after_sync" as const, deps };
      const t = a.trigger;
      if (t.type === "transaction") {
        const ids = matchingTransactionIds(db, a, sync.newIds);
        if (ids.length) await runAutomation(db, a, { ...base, matches: loadTxnLite(db, ids, timeZone) });
      } else if (t.type === "target_exceeded") {
        for (const p of getTargetProgress(db, month, now, timeZone)) {
          if (p.kind !== "category" || p.status !== "over") continue;
          await runAutomation(db, a, {
            ...base,
            dedupeKey: `target:${p.subjectId}:${month}`,
            vars: { category: p.name },
          });
        }
      } else if (t.type === "balance_below") {
        const acct = db.select().from(accounts).where(eq(accounts.id, t.accountId)).get();
        if (acct && acct.balanceCents < t.cents)
          await runAutomation(db, a, {
            ...base,
            dedupeKey: `balance:${t.accountId}:${today}`,
            vars: { account: a.includeDetails ? acct.displayName || acct.name : "an account" },
          });
      }
    }
  } catch (err) {
    logger.warn({ err }, "automations after sync failed");
  }
}

/** A scheduled run: reloads the automation (it may have changed or been disabled since the timer was set). */
export async function runScheduledAutomation(
  db: DbLike,
  id: number,
  now: number,
  timeZone: string,
  deps?: Deps,
): Promise<void> {
  try {
    const a = getAutomation(db, id);
    if (!a.enabled) return;
    await runAutomation(db, a, { now, timeZone, trigger: "schedule", deps });
  } catch (err) {
    logger.warn({ err, automationId: id }, "scheduled automation failed");
  }
}

/** "Run now": a transaction trigger uses the newest matching transaction of the last 30 days as the example. */
export async function runAutomationNow(
  db: DbLike,
  id: number,
  now: number,
  timeZone: string,
  deps?: Deps,
): Promise<RunOutcome> {
  const a = getAutomation(db, id);
  const base = { now, timeZone, trigger: "manual" as const, deps };
  const t = a.trigger;
  if (t.type === "transaction") {
    const recent = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(gte(effectiveDateSql, now - 30 * 86_400))
      .orderBy(desc(effectiveDateSql), desc(transactions.id))
      .limit(1000)
      .all()
      .map((r) => r.id);
    // loadTxnLite returns newest first
    const newest = loadTxnLite(db, matchingTransactionIds(db, a, recent), timeZone).slice(0, 1);
    if (newest.length === 0)
      return { status: "skipped", reason: "No matching transaction in the last 30 days to use as an example." };
    return runAutomation(db, a, { ...base, matches: newest });
  }
  if (t.type === "target_exceeded") {
    const month = currentMonth(now, timeZone);
    const first = getTargetProgress(db, month, now, timeZone).find((p) => p.kind === "category");
    return runAutomation(db, a, { ...base, vars: { category: first?.name ?? "a category" } });
  }
  if (t.type === "balance_below") {
    const acct = db.select().from(accounts).where(eq(accounts.id, t.accountId)).get();
    return runAutomation(db, a, {
      ...base,
      vars: { account: acct && a.includeDetails ? acct.displayName || acct.name : "an account" },
    });
  }
  return runAutomation(db, a, base);
}
