import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { acceptAll } from "@/lib/ai/proposals";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const body = z.object({ minConfidence: z.enum(["high", "medium"]), applyExisting: z.boolean().default(true) }).strict();

/** Accepts every pending suggestion at or above the confidence that doesn't conflict with the owner's own choices. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const input = body.parse(await readJson(request));
    return NextResponse.json(acceptAll(getDb(), input, Math.floor(Date.now() / 1000), getEnv().TZ));
  } catch (e) {
    return errorResponse(e);
  }
}
