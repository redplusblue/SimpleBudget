import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { createGoal, listGoalProgress } from "@/lib/finance/goals";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ goals: listGoalProgress(getDb(), Math.floor(Date.now() / 1000), getEnv().TZ) });
}

/** `{ name, accountId, targetCents, startCents?, targetDate? }` */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const id = createGoal(getDb(), await readJson(request));
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
