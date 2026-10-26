import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { usageReport } from "@/lib/llm/runs";

export const dynamic = "force-dynamic";

/** This month's AI spend, the budget, per-feature totals and the last 20 runs (never any prompt text). */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ usage: usageReport(getDb(), Math.floor(Date.now() / 1000), getEnv().TZ) });
}
