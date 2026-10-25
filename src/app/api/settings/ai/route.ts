import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getAiConfig, updateAiConfig } from "@/lib/llm/config";

export const dynamic = "force-dynamic";

/** The AI settings. The API key is write-only: responses say whether one is saved, never what it is. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ config: getAiConfig(getDb()) });
}

export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ config: updateAiConfig(getDb(), await readJson(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}
