import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getUpcoming } from "@/lib/finance/dashboard";

export const dynamic = "force-dynamic";

/** The dashboard's "Upcoming" card: next recurring charges and the monthly total. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const started = performance.now();
  const upcoming = getUpcoming(getDb(), Math.floor(Date.now() / 1000), getEnv().TZ);
  return NextResponse.json(upcoming, {
    headers: { "Server-Timing": `upcoming;dur=${(performance.now() - started).toFixed(1)}` },
  });
}
