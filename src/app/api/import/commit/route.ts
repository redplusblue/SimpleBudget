import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { commitImport } from "@/lib/import/plan";

export const dynamic = "force-dynamic";

/** Imports the file as previewed. Safe to repeat: rows already present are matched, not added again. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({
      result: commitImport(getDb(), await readJson(request), Math.floor(Date.now() / 1000), getEnv().TZ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
