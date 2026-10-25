import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { detectRecurring } from "@/lib/finance/recurring";

export const dynamic = "force-dynamic";

/** Detected subscriptions and regular bills, with their next expected dates and monthly cost. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json(detectRecurring(getDb(), Math.floor(Date.now() / 1000), getEnv().TZ));
}
