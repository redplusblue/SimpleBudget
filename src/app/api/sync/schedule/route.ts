import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { reschedule } from "@/lib/simplefin/scheduler";
import { setSchedule, SCHEDULE_OPTIONS } from "@/lib/simplefin/status";

export const dynamic = "force-dynamic";

const body = z.object({ schedule: z.enum(Object.keys(SCHEDULE_OPTIONS) as [keyof typeof SCHEDULE_OPTIONS]) });

export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  setSchedule(getDb(), parsed.data.schedule);
  reschedule();
  return NextResponse.json({ ok: true });
}
