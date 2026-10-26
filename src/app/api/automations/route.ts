import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { rescheduleAutomations } from "@/lib/automations/scheduler";
import { createAutomation, listAutomations } from "@/lib/automations/store";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ automations: listAutomations(getDb()) });
}

export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const automation = createAutomation(getDb(), (await readJson(request)) ?? {});
    rescheduleAutomations();
    return NextResponse.json({ automation }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
