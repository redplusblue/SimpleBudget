import { like, lt, and } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { settings } from "@/db/schema";
import { DAY, utcDateString } from "@/lib/finance/dates";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

/** The Bridge allows ~24 requests/day; we stop at 20 to leave headroom. */
export const DAILY_REQUEST_LIMIT = 20;
/** A single request may span at most ~90 days; we use 60 to stay well clear. */
export const MAX_WINDOW_DAYS = 60;
export const INCREMENTAL_DAYS = 14;
export const MANUAL_SYNC_COOLDOWN_SECONDS = 15 * 60;
export const LOCK_TTL_SECONDS = 10 * 60;

const REQ_PREFIX = "sfin_requests:";
const LOCK_KEY = "sync_lock";
const PROGRESS_KEY = "sync_progress";
const LAST_MANUAL_KEY = "last_manual_sync";

// ── daily request budget ────────────────────────────────────────────────────

export function requestsToday(db: DbLike, now: number): number {
  return Number(getSetting(db, `${REQ_PREFIX}${utcDateString(now)}`) ?? 0) || 0;
}

export function requestsRemaining(db: DbLike, now: number): number {
  return Math.max(0, DAILY_REQUEST_LIMIT - requestsToday(db, now));
}

/** Counts one HTTP attempt against today's quota (UTC day) and prunes older counters. */
export function recordRequest(db: DbLike, now: number): void {
  const today = utcDateString(now);
  setSetting(db, `${REQ_PREFIX}${today}`, String(requestsToday(db, now) + 1));
  db.delete(settings)
    .where(and(like(settings.key, `${REQ_PREFIX}%`), lt(settings.key, `${REQ_PREFIX}${today}`)))
    .run();
}

// ── windows ─────────────────────────────────────────────────────────────────

export interface Window {
  start: number;
  end: number;
}

/** Splits the last `days` days into ≤ `maxDays` windows, newest first. */
export function buildWindows(now: number, days: number, maxDays = MAX_WINDOW_DAYS): Window[] {
  const windows: Window[] = [];
  const earliest = now - days * DAY;
  let end = now;
  while (end > earliest) {
    const start = Math.max(earliest, end - maxDays * DAY);
    windows.push({ start, end });
    end = start;
  }
  return windows;
}

// ── lock ────────────────────────────────────────────────────────────────────

/** Takes the single-sync lock unless a live one exists. The check-and-set is one transaction. */
export function acquireSyncLock(db: DbLike, now: number, ttl = LOCK_TTL_SECONDS): boolean {
  return db.transaction((tx) => {
    const held = Number(getSetting(tx, LOCK_KEY) ?? 0);
    if (held > now) return false;
    setSetting(tx, LOCK_KEY, String(now + ttl));
    return true;
  });
}

export function renewSyncLock(db: DbLike, now: number, ttl = LOCK_TTL_SECONDS): void {
  setSetting(db, LOCK_KEY, String(now + ttl));
}

export function releaseSyncLock(db: DbLike): void {
  deleteSetting(db, LOCK_KEY);
  deleteSetting(db, PROGRESS_KEY);
}

export function isSyncRunning(db: DbLike, now: number): boolean {
  return Number(getSetting(db, LOCK_KEY) ?? 0) > now;
}

// ── progress ────────────────────────────────────────────────────────────────

export interface SyncProgress {
  done: number;
  total: number;
}

export function setSyncProgress(db: DbLike, progress: SyncProgress): void {
  setSetting(db, PROGRESS_KEY, JSON.stringify(progress));
}

export function getSyncProgress(db: DbLike): SyncProgress | null {
  const raw = getSetting(db, PROGRESS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SyncProgress;
  } catch {
    return null;
  }
}

// ── manual sync throttle ────────────────────────────────────────────────────

/** Seconds until another manual incremental sync is allowed (0 = allowed now). */
export function manualSyncWaitSeconds(db: DbLike, now: number): number {
  const last = Number(getSetting(db, LAST_MANUAL_KEY) ?? 0);
  return Math.max(0, last + MANUAL_SYNC_COOLDOWN_SECONDS - now);
}

export function markManualSync(db: DbLike, now: number): void {
  setSetting(db, LAST_MANUAL_KEY, String(now));
}
