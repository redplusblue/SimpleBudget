import "server-only";
import path from "node:path";
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { listBackups, runBackup } from "./backups";

const g = globalThis as unknown as { __sbBackupCron?: ScheduledTask };

export function backupDir(): string {
  const env = getEnv();
  return env.BACKUP_DIR ?? path.join(path.dirname(path.resolve(env.DATABASE_PATH)), "backups");
}

export function backupNow(): ReturnType<typeof runBackup> {
  const file = runBackup(getDb(), backupDir(), Math.floor(Date.now() / 1000));
  logger.info({ file: file.name, sizeBytes: file.sizeBytes }, "database backup written");
  return file;
}

/** Nightly at 03:30 local time, plus one shortly after boot if there is no backup from the last 24 hours. */
export function startBackupScheduler(): void {
  if (g.__sbBackupCron) return;
  const run = () => {
    try {
      backupNow();
    } catch (err) {
      logger.error({ err }, "nightly backup failed");
    }
  };
  g.__sbBackupCron = cron.schedule("30 3 * * *", run, { timezone: getEnv().TZ, noOverlap: true });
  const newest = listBackups(backupDir())[0];
  if (!newest || Date.now() / 1000 - newest.createdAt > 24 * 3600) setTimeout(run, 60_000).unref?.();
}
