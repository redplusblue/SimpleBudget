import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { addConnection } from "@/lib/connections";
import { acquireSyncLock, recordRequest, setSyncProgress } from "@/lib/simplefin/limits";
import { getSchedule, getSyncStatus, listSyncRuns, setSchedule } from "@/lib/simplefin/status";
import { runSync } from "@/lib/simplefin/sync";
import { ACCESS_URL, mockBank, NOW } from "../helpers/simplefin-mock";

function setup() {
  const db = createDb(openSqlite(":memory:"));
  runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
  return db;
}

describe("sync status", () => {
  it("is empty on a fresh install", () => {
    const s = getSyncStatus(setup(), NOW);
    expect(s).toMatchObject({
      running: false,
      hasConnections: false,
      lastRun: null,
      lastSuccessAt: null,
      requestsToday: 0,
      requestLimit: 20,
      manualWaitSeconds: 0,
      schedule: "6h",
      connectionErrors: [],
    });
  });

  it("reports progress only while running", () => {
    const db = setup();
    setSyncProgress(db, { done: 1, total: 4 });
    expect(getSyncStatus(db, NOW).progress).toBeNull();
    acquireSyncLock(db, NOW);
    expect(getSyncStatus(db, NOW)).toMatchObject({ running: true, progress: { done: 1, total: 4 } });
  });

  it("summarizes the last run, last success and connection errors after syncing", async () => {
    const db = setup();
    addConnection(db, ACCESS_URL);
    const bank = mockBank();
    bank.errors = ["Please re-authenticate"];
    await runSync(db, { mode: "backfill", days: 30, trigger: "manual", now: NOW, fetchImpl: bank.fetch });
    const s = getSyncStatus(db, NOW + 60);
    expect(s.lastRun).toMatchObject({ status: "partial", errors: ["Please re-authenticate"] });
    expect(s.lastSuccessAt).not.toBeNull();
    expect(s.hasConnections).toBe(true);
    expect(s.connectionErrors).toEqual(["Please re-authenticate"]);
    expect(s.requestsToday).toBe(1);
    expect(listSyncRuns(db)).toHaveLength(1);
  });

  it("doesn't count a failed run as a success", async () => {
    const db = setup();
    addConnection(db, ACCESS_URL);
    const bank = mockBank();
    bank.status = 403;
    await runSync(db, { mode: "backfill", days: 30, trigger: "manual", now: NOW, fetchImpl: bank.fetch });
    expect(getSyncStatus(db, NOW).lastSuccessAt).toBeNull();
    expect(getSyncStatus(db, NOW).lastRun?.status).toBe("error");
  });

  it("lists runs newest first and honors the limit", async () => {
    const db = setup();
    addConnection(db, ACCESS_URL);
    const bank = mockBank();
    for (let i = 0; i < 3; i++)
      await runSync(db, { mode: "backfill", days: 30, trigger: "scheduled", now: NOW + i, fetchImpl: bank.fetch });
    const runs = listSyncRuns(db, 2);
    expect(runs.map((r) => r.id)).toEqual([3, 2]);
  });

  it("stores the schedule and ignores junk values", () => {
    const db = setup();
    setSchedule(db, "12h");
    expect(getSchedule(db)).toBe("12h");
    recordRequest(db, NOW);
    expect(getSyncStatus(db, NOW).schedule).toBe("12h");
  });
});
