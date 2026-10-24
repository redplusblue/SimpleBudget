import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { listSyncRuns } from "@/lib/simplefin/status";

export const dynamic = "force-dynamic";

const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  return NextResponse.json({ runs: listSyncRuns(getDb(), parsed.data.limit) });
}
