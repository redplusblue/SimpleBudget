import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { createBackup } from "@/lib/export/backup";
import { localDateString } from "@/lib/finance/dates";

export const dynamic = "force-dynamic";

/** A SQLite backup of everything, as a download. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const bytes = createBackup(getDb());
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.sqlite3",
      "content-disposition": `attachment; filename="simplebudget-backup-${localDateString(Math.floor(Date.now() / 1000), getEnv().TZ)}.sqlite"`,
      "content-length": String(bytes.length),
      "cache-control": "no-store",
    },
  });
}
