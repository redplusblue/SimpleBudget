import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

/** Every deterministic insight for the current month, most important first. Works with AI switched off. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const started = performance.now();
  const payload = getInsights(getDb(), { now: Math.floor(Date.now() / 1000), timeZone: getEnv().TZ }, (e) =>
    logger.error({ err: e }, "insight generator failed"),
  );
  return NextResponse.json(payload, {
    headers: { "Server-Timing": `insights;dur=${(performance.now() - started).toFixed(1)}` },
  });
}
