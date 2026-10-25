import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { reconcile } from "@/lib/finance/reconcile";

export const dynamic = "force-dynamic";

/** `{ date, balanceCents, markReviewed? }`: compares the statement balance with what the app's records add up to. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({
      result: reconcile(getDb(), decodeURIComponent((await params).id), await readJson(request), getEnv().TZ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
