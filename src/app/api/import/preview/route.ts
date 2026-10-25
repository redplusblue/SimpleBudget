import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { previewImport } from "@/lib/import/plan";

export const dynamic = "force-dynamic";

/** What importing this file would do (nothing is written). */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ preview: previewImport(getDb(), await readJson(request), getEnv().TZ) });
  } catch (e) {
    return errorResponse(e);
  }
}
