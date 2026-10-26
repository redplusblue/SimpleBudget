import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { runAutomationNow } from "@/lib/automations/fire";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Runs it now. AI actions still respect the monthly budget; the outcome says what happened. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json(await runAutomationNow(getDb(), id.data, Math.floor(Date.now() / 1000), getEnv().TZ));
  } catch (e) {
    return errorResponse(e);
  }
}
