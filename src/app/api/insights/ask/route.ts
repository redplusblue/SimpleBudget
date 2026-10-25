import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getLlm } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { answerQuestion, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS } from "@/lib/llm/narrative";

export const dynamic = "force-dynamic";

const body = z.object({
  question: z.string().trim().min(1, "Ask a question").max(MAX_QUESTION_CHARS),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(MAX_HISTORY_TURNS * 2)
    .optional(),
});

/** "Ask about your spending": answers from aggregates plus read-only lookup tools. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const db = getDb();
  const llm = getLlm(db);
  if (!llm) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
  const config = getAiConfig(db);
  try {
    const answer = await answerQuestion(
      {
        db,
        llm,
        model: config.model,
        includeBalances: config.includeBalances,
        now: Math.floor(Date.now() / 1000),
        timeZone: getEnv().TZ,
      },
      parsed.data.question,
      parsed.data.history,
    );
    return NextResponse.json({ answer });
  } catch (e) {
    return errorResponse(e);
  }
}
