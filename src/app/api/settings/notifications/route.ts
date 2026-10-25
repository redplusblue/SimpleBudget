import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getNotifyConfig, updateNotifyConfig } from "@/lib/notify/config";

export const dynamic = "force-dynamic";

/** Notification settings. The address and token are write-only: responses only say whether they exist (and the host). */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ config: getNotifyConfig(getDb()) });
}

export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ config: updateNotifyConfig(getDb(), await readJson(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}
