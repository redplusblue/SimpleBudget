import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { backupDir } from "@/lib/backup/scheduler";
import { listBackups } from "@/lib/backup/backups";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const size = (file: string) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

/** Version, database size and the backups on disk. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const env = getEnv();
  const backups = listBackups(backupDir());
  return NextResponse.json({
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    nodeVersion: process.version,
    timeZone: env.TZ,
    dbSizeBytes: size(env.DATABASE_PATH) + size(`${env.DATABASE_PATH}-wal`),
    backups: backups.slice(0, 5),
    backupCount: backups.length,
    lastBackupAt: backups[0]?.createdAt ?? null,
  });
}
