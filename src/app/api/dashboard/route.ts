import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getDashboard } from "@/lib/finance/dashboard";

export const dynamic = "force-dynamic";

const query = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10")
    .optional(),
});

/** Everything the home page shows, for the current month or `?month=YYYY-MM`. */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request", message: parsed.error.issues[0]?.message }, { status: 400 });
  const payload = getDashboard(getDb(), {
    month: parsed.data.month,
    now: Math.floor(Date.now() / 1000),
    timeZone: getEnv().TZ,
  });
  return NextResponse.json(payload);
}
