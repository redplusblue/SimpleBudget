import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, transactions } from "@/db/schema";
import { formatCents } from "@/lib/finance/cents";
import { localDateString } from "@/lib/finance/dates";
import { effectiveDateSql } from "@/lib/finance/sql";
import { logger } from "@/lib/logger";
import { getSetting, setSetting } from "@/lib/settings";
import { getNotifyConfig, getNotifyTarget } from "./config";
import { sendNotification, type Notification } from "./send";

/** At most this many individual large-transaction messages per sync; the rest are summarized in one. */
export const MAX_LARGE_MESSAGES = 5;
/** The same kind of failure is announced at most once in this many seconds. */
export const FAILURE_COOLDOWN_SECONDS = 6 * 3600;
const LAST_FAILURE_KEY = "notify:last_failure_at";

export interface SyncOutcome {
  status: "ok" | "partial" | "error";
  errors: string[];
  /** Ids of transactions this sync inserted. */
  newIds: number[];
}

/** Messages worth sending after a sync (pure apart from reading the database). */
export function buildSyncNotifications(
  db: DbLike,
  outcome: SyncOutcome,
  now: number,
  timeZone: string,
): Notification[] {
  const cfg = getNotifyConfig(db);
  const out: Notification[] = [];

  if (cfg.onFailure && outcome.status !== "ok") {
    const last = Number(getSetting(db, LAST_FAILURE_KEY) ?? 0);
    if (now - last >= FAILURE_COOLDOWN_SECONDS) {
      const first = outcome.errors[0] ?? "Something went wrong.";
      out.push({
        event: "sync_failed",
        priority: "high",
        title: outcome.status === "error" ? "SimpleBudget sync failed" : "SimpleBudget sync finished with problems",
        message: first.slice(0, 300),
      });
      setSetting(db, LAST_FAILURE_KEY, String(now));
    }
  }

  if (cfg.onLarge && outcome.newIds.length) {
    const rows = db
      .select({
        id: transactions.id,
        cents: transactions.amountCents,
        at: effectiveDateSql,
        payee: sql<string>`coalesce(${transactions.payeeOverride}, ${transactions.payee}, ${transactions.description})`,
        account: sql<string>`coalesce(${accounts.displayName}, ${accounts.name})`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          inArray(transactions.id, outcome.newIds),
          eq(transactions.isTransfer, false),
          eq(transactions.isExcluded, false),
          sql`abs(${transactions.amountCents}) >= ${cfg.largeCents}`,
        ),
      )
      .orderBy(sql`abs(${transactions.amountCents}) desc`)
      .all();
    for (const r of rows.slice(0, MAX_LARGE_MESSAGES)) {
      const amount = formatCents(Math.abs(r.cents));
      const what = r.cents < 0 ? "spent" : "received";
      out.push({
        event: "large_transaction",
        title: r.cents < 0 ? "Large purchase" : "Large deposit",
        message: cfg.details
          ? `${amount} ${r.cents < 0 ? "at" : "from"} ${r.payee} on ${localDateString(r.at, timeZone)} (${r.account})`
          : `A large amount was ${what}: ${amount}. Open SimpleBudget for details.`,
      });
    }
    if (rows.length > MAX_LARGE_MESSAGES)
      out.push({
        event: "large_transaction",
        title: "More large transactions",
        message: `${rows.length - MAX_LARGE_MESSAGES} more transactions of ${formatCents(cfg.largeCents)} or more were added.`,
      });
  }
  return out;
}

/** Called when a sync finishes. Does nothing unless notifications are on; failures to notify are logged, never thrown. */
export async function notifyAfterSync(
  db: DbLike,
  outcome: SyncOutcome,
  now: number,
  timeZone: string,
  fetchImpl?: typeof fetch,
): Promise<number> {
  try {
    const cfg = getNotifyConfig(db);
    if (!cfg.enabled) return 0;
    const target = getNotifyTarget(db);
    if (!target) return 0;
    let sent = 0;
    for (const n of buildSyncNotifications(db, outcome, now, timeZone)) {
      const res = await sendNotification(target, n, fetchImpl);
      if (res.ok) sent++;
      else logger.warn({ event: n.event, status: res.status }, "notification could not be delivered");
    }
    return sent;
  } catch (err) {
    logger.warn({ err }, "notifications failed");
    return 0;
  }
}
