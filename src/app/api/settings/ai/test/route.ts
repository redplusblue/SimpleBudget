import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getLlm } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Sends a tiny fixed prompt (no financial data) to check the key, model and URL. */
export async function POST() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const llm = getLlm(getDb());
  if (!llm)
    return NextResponse.json({ error: "ai_disabled", message: "Turn AI on (with a key) first." }, { status: 409 });
  try {
    const reply = await llm.generate({ system: "Reply with the single word OK.", user: "ping", maxTokens: 16 });
    return NextResponse.json({ ok: true, reply: reply.slice(0, 40) });
  } catch (e) {
    return errorResponse(e);
  }
}
