import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { createTarget, listTargets } from "@/lib/finance/targets";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ targets: listTargets(getDb()) });
}

/** `{ kind: "category" | "tag", subjectId, amountCents, month?: "YYYY-MM" }` (no month = every month). */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ target: createTarget(getDb(), await readJson(request)) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
