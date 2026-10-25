import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { localDateString } from "@/lib/finance/dates";
import { getYearInReview, YearError } from "@/lib/finance/year";

export const dynamic = "force-dynamic";

/** `?year=2025` (default: this year). */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const now = Math.floor(Date.now() / 1000);
  const tz = getEnv().TZ;
  const raw = new URL(request.url).searchParams.get("year");
  const year = raw === null ? Number(localDateString(now, tz).slice(0, 4)) : Number(raw);
  try {
    return NextResponse.json(getYearInReview(getDb(), year, now, tz));
  } catch (e) {
    if (e instanceof YearError)
      return NextResponse.json({ error: "invalid_request", message: e.message }, { status: 400 });
    throw e;
  }
}
