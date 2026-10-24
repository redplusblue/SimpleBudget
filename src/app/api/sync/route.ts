import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { startSync, type SyncRefusal } from "@/lib/simplefin/sync";

export const dynamic = "force-dynamic";

const body = z
  .object({
    mode: z.enum(["incremental", "backfill"]).default("incremental"),
    days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).optional(),
  })
  .default({ mode: "incremental" });

const STATUS: Record<SyncRefusal["reason"], number> = {
  busy: 409,
  no_connections: 409,
  throttled: 429,
  budget: 429,
};

/** Starts a sync in the background and returns immediately; poll /api/sync/status for progress. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  let json: unknown;
  try {
    const text = (await request.text()).trim();
    json = text ? JSON.parse(text) : undefined;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const started = startSync(getDb(), { ...parsed.data, trigger: "manual" });
  if (!started.ok) {
    return NextResponse.json(
      { error: started.reason, message: started.message, retryAfterSeconds: started.retryAfterSeconds },
      {
        status: STATUS[started.reason],
        headers: started.retryAfterSeconds ? { "Retry-After": String(started.retryAfterSeconds) } : undefined,
      },
    );
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
