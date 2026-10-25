import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { createRule, listRules } from "@/lib/rules/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ rules: listRules(getDb()) });
}

export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ rule: createRule(getDb(), await readJson(request)) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
