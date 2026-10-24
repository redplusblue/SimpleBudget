import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { DAY } from "@/lib/finance/dates";
import {
  acquireSyncLock,
  buildWindows,
  DAILY_REQUEST_LIMIT,
  getSyncProgress,
  isSyncRunning,
  manualSyncWaitSeconds,
  markManualSync,
  recordRequest,
  releaseSyncLock,
  requestsRemaining,
  requestsToday,
  setSyncProgress,
} from "@/lib/simplefin/limits";

const freshDb = () => {
  const db = createDb(openSqlite(":memory:"));
  runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
  return db;
};
const NOW = Date.UTC(2026, 9, 24, 12) / 1000;

describe("buildWindows", () => {
  it("splits into ≤60 day windows, newest first, covering the range exactly", () => {
    const w = buildWindows(NOW, 365);
    expect(w).toHaveLength(7);
    expect(w[0].end).toBe(NOW);
    expect(w[6].start).toBe(NOW - 365 * DAY);
    for (const x of w) expect(x.end - x.start).toBeLessThanOrEqual(60 * DAY);
    for (let i = 1; i < w.length; i++) expect(w[i].end).toBe(w[i - 1].start);
  });
  it("uses one window for short ranges", () => {
    expect(buildWindows(NOW, 14)).toEqual([{ start: NOW - 14 * DAY, end: NOW }]);
    expect(buildWindows(NOW, 60)).toHaveLength(1);
    expect(buildWindows(NOW, 61)).toHaveLength(2);
  });
});

describe("daily request counter", () => {
  it("counts per UTC day and prunes old days", () => {
    const db = freshDb();
    recordRequest(db, NOW - DAY);
    expect(requestsToday(db, NOW)).toBe(0);
    for (let i = 0; i < 3; i++) recordRequest(db, NOW);
    expect(requestsToday(db, NOW)).toBe(3);
    expect(requestsRemaining(db, NOW)).toBe(DAILY_REQUEST_LIMIT - 3);
    expect(requestsToday(db, NOW - DAY)).toBe(0); // yesterday's row was pruned
  });
  it("never reports negative remaining", () => {
    const db = freshDb();
    for (let i = 0; i < DAILY_REQUEST_LIMIT + 2; i++) recordRequest(db, NOW);
    expect(requestsRemaining(db, NOW)).toBe(0);
  });
});

describe("sync lock", () => {
  it("is exclusive until released or expired", () => {
    const db = freshDb();
    expect(acquireSyncLock(db, NOW)).toBe(true);
    expect(isSyncRunning(db, NOW)).toBe(true);
    expect(acquireSyncLock(db, NOW + 5)).toBe(false);
    expect(acquireSyncLock(db, NOW + 601)).toBe(true); // expired
    releaseSyncLock(db);
    expect(isSyncRunning(db, NOW + 602)).toBe(false);
    expect(acquireSyncLock(db, NOW + 602)).toBe(true);
  });
  it("clears progress on release", () => {
    const db = freshDb();
    setSyncProgress(db, { done: 1, total: 3 });
    expect(getSyncProgress(db)).toEqual({ done: 1, total: 3 });
    releaseSyncLock(db);
    expect(getSyncProgress(db)).toBeNull();
  });
});

describe("manual throttle", () => {
  it("allows once per 15 minutes", () => {
    const db = freshDb();
    expect(manualSyncWaitSeconds(db, NOW)).toBe(0);
    markManualSync(db, NOW);
    expect(manualSyncWaitSeconds(db, NOW + 60)).toBe(840);
    expect(manualSyncWaitSeconds(db, NOW + 900)).toBe(0);
  });
});
