import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth";
import { backupNow } from "@/lib/backup/scheduler";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** "Back up now": writes a backup into the backups folder (the nightly job does the same). */
export async function POST() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ backup: backupNow() });
  } catch (err) {
    logger.error({ err }, "manual backup failed");
    return NextResponse.json(
      { error: "backup_failed", message: "Couldn't write the backup. Check that the data folder is writable." },
      { status: 500 },
    );
  }
}
