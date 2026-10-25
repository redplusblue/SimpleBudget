import "server-only";
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { logger } from "@/lib/logger";
import { getSetupState } from "@/lib/setup";
import { getSchedule, getSyncStatus, SCHEDULE_OPTIONS, type ScheduleKey } from "./status";
import { recordRefusedRun, runSync } from "./sync";

const CATCH_UP_DELAY_MS = 30_000;
const INTERVAL_SECONDS: Record<Exclude<ScheduleKey, "off">, number> = {
  "3h": 3 * 3600,
  "6h": 6 * 3600,
  "12h": 12 * 3600,
  "24h": 24 * 3600,
};

const g = globalThis as unknown as { __sbCron?: ScheduledTask; __sbCatchUp?: NodeJS.Timeout };

async function tick() {
  try {
    const db = getDb();
    if (
      getSetupState(db) !== "complete" ||
      db.select({ id: connections.id }).from(connections).limit(1).get() === undefined
    ) {
      return;
    }
    const res = await runSync(db, { mode: "incremental", trigger: "scheduled" });
    if (!res.ok && res.reason === "budget") recordRefusedRun(db, res);
  } catch (err) {
    // A failed tick must never take the server down; the next one retries.
    logger.error({ err }, "scheduled sync failed");
  }
}

/** (Re)reads the schedule setting and (re)starts the cron task. Safe to call repeatedly. */
export function reschedule(): void {
  g.__sbCron?.stop();
  g.__sbCron?.destroy();
  g.__sbCron = undefined;
  if (g.__sbCatchUp) clearTimeout(g.__sbCatchUp);

  const db = getDb();
  const key = getSchedule(db);
  const expr = SCHEDULE_OPTIONS[key].cron;
  if (!expr) return;

  g.__sbCron = cron.schedule(expr, tick, { timezone: process.env.TZ || "UTC", noOverlap: true });

  // If the server was down through a scheduled run, catch up shortly after boot.
  const { lastSuccessAt } = getSyncStatus(db);
  const stale =
    lastSuccessAt === null || Date.now() / 1000 - lastSuccessAt > INTERVAL_SECONDS[key as Exclude<ScheduleKey, "off">];
  if (stale) {
    g.__sbCatchUp = setTimeout(tick, CATCH_UP_DELAY_MS);
    g.__sbCatchUp.unref?.();
  }
}

/** Starts the background scheduler once per process (guarded across hot reloads). */
export function startScheduler(): void {
  if (g.__sbCron) return;
  reschedule();
}
