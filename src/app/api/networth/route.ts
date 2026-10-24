import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getNetWorthSummary, NET_WORTH_RANGES } from "@/lib/finance/networth";

export const dynamic = "force-dynamic";

const query = z.object({
  range: z.enum(Object.keys(NET_WORTH_RANGES) as [keyof typeof NET_WORTH_RANGES]).default("3M"),
});

/** Net worth summary plus the daily series for `?range=1M|3M|6M|1Y|ALL`. */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid_request", message: "range must be 1M, 3M, 6M, 1Y or ALL" },
      { status: 400 },
    );
  return NextResponse.json(getNetWorthSummary(getDb(), parsed.data.range, Math.floor(Date.now() / 1000), getEnv().TZ));
}
