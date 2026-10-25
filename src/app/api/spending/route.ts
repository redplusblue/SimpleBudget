import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getSpendingReport, ReportError } from "@/lib/finance/spending-report";

export const dynamic = "force-dynamic";

/**
 * Spending analytics for `?month=YYYY-MM` (default: the current month) or a custom `?from=YYYY-MM-DD&to=YYYY-MM-DD`
 * (inclusive, at most 366 days).
 */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const now = Math.floor(Date.now() / 1000);
  const timeZone = getEnv().TZ;
  const from = params.get("from");
  const to = params.get("to");
  const month = params.get("month");
  if ((from === null) !== (to === null))
    return NextResponse.json({ error: "invalid_request", message: "Provide both from and to" }, { status: 400 });
  try {
    const started = performance.now();
    const input = from !== null && to !== null ? { from, to } : { month: month ?? localMonth(now, timeZone) };
    const report = getSpendingReport(getDb(), input, now, timeZone);
    return NextResponse.json(report, {
      headers: { "Server-Timing": `spending;dur=${(performance.now() - started).toFixed(1)}` },
    });
  } catch (e) {
    if (e instanceof ReportError)
      return NextResponse.json({ error: "invalid_request", message: e.message }, { status: 400 });
    throw e;
  }
}

function localMonth(now: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
    .format(new Date(now * 1000))
    .slice(0, 7);
}
