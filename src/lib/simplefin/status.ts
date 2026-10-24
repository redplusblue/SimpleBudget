import { desc, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/open";
import { connections, syncRuns } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import {
  DAILY_REQUEST_LIMIT,
  getSyncProgress,
  isSyncRunning,
  manualSyncWaitSeconds,
  requestsToday,
  type SyncProgress,
} from "./limits";

export const SCHEDULE_OPTIONS = {
  off: { label: "Off (manual only)", cron: null },
  "3h": { label: "Every 3 hours", cron: "0 */3 * * *" },
  "6h": { label: "Every 6 hours", cron: "0 */6 * * *" },
  "12h": { label: "Every 12 hours", cron: "0 */12 * * *" },
  "24h": { label: "Daily", cron: "0 6 * * *" },
} as const;

export type ScheduleKey = keyof typeof SCHEDULE_OPTIONS;
export const DEFAULT_SCHEDULE: ScheduleKey = "6h";
const SCHEDULE_SETTING = "sync_schedule";

export function getSchedule(db: Db): ScheduleKey {
  const v = getSetting(db, SCHEDULE_SETTING);
  return v && v in SCHEDULE_OPTIONS ? (v as ScheduleKey) : DEFAULT_SCHEDULE;
}

export function setSchedule(db: Db, key: ScheduleKey): void {
  setSetting(db, SCHEDULE_SETTING, key);
}

export interface SyncRunSummary {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: "ok" | "partial" | "error";
  requestsUsed: number;
  accountsUpdated: number;
  txnsAdded: number;
  txnsUpdated: number;
  errors: string[];
}

function parseErrors(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function listSyncRuns(db: Db, limit = 20): SyncRunSummary[] {
  return db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.id))
    .limit(limit)
    .all()
    .map(({ errorsJson, ...r }) => ({ ...r, errors: parseErrors(errorsJson) }));
}

export interface SyncStatus {
  running: boolean;
  progress: SyncProgress | null;
  hasConnections: boolean;
  /** Most recent finished run, if any. */
  lastRun: SyncRunSummary | null;
  /** Unix seconds of the last run that imported data (ok or partial). */
  lastSuccessAt: number | null;
  requestsToday: number;
  requestLimit: number;
  /** Seconds until a manual sync is allowed again. */
  manualWaitSeconds: number;
  schedule: ScheduleKey;
  /** Latest per-connection problems (e.g. revoked access), shown alongside the last run's errors. */
  connectionErrors: string[];
}

export function getSyncStatus(db: Db, now = Math.floor(Date.now() / 1000)): SyncStatus {
  const lastRun =
    db
      .select()
      .from(syncRuns)
      .where(isNotNull(syncRuns.finishedAt))
      .orderBy(desc(syncRuns.id))
      .limit(1)
      .all()
      .map(({ errorsJson, ...r }) => ({ ...r, errors: parseErrors(errorsJson) }))[0] ?? null;
  const lastSuccess = db
    .select({ finishedAt: syncRuns.finishedAt, status: syncRuns.status })
    .from(syncRuns)
    .where(isNotNull(syncRuns.finishedAt))
    .orderBy(desc(syncRuns.id))
    .limit(20)
    .all()
    .find((r) => r.status !== "error");
  const conns = db.select({ lastError: connections.lastError }).from(connections).all();
  const running = isSyncRunning(db, now);
  return {
    running,
    progress: running ? getSyncProgress(db) : null,
    hasConnections: conns.length > 0,
    lastRun,
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    requestsToday: requestsToday(db, now),
    requestLimit: DAILY_REQUEST_LIMIT,
    manualWaitSeconds: manualSyncWaitSeconds(db, now),
    schedule: getSchedule(db),
    connectionErrors: conns.flatMap((c) => (c.lastError ? [c.lastError] : [])),
  };
}
