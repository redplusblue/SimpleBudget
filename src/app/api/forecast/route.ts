import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getForecast } from "@/lib/finance/forecast";

export const dynamic = "force-dynamic";

/** A 30-day cash-flow projection from recurring bills and income. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const started = performance.now();
  const forecast = getForecast(getDb(), Math.floor(Date.now() / 1000), getEnv().TZ);
  return NextResponse.json(forecast, {
    headers: { "Server-Timing": `forecast;dur=${(performance.now() - started).toFixed(1)}` },
  });
}
