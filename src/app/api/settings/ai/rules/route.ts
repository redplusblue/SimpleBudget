import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getRuleSuggestSettings, updateRuleSuggestSettings } from "@/lib/ai/rule-settings";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ settings: getRuleSuggestSettings(getDb()) });
}

export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ settings: updateRuleSuggestSettings(getDb(), await readJson(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}
