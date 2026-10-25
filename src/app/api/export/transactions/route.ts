import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { exportTransactionsCsv } from "@/lib/export/transactions";
import { localDateString } from "@/lib/finance/dates";

export const dynamic = "force-dynamic";

/** Every transaction as a CSV download. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const tz = getEnv().TZ;
  const csv = exportTransactionsCsv(getDb(), tz);
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="simplebudget-transactions-${localDateString(Math.floor(Date.now() / 1000), tz)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
