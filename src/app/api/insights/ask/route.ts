import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getLlmFor } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";
import { answerQuestion, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS } from "@/lib/llm/narrative";

export const dynamic = "force-dynamic";

const body = z.object({
  model: z.string().trim().min(1).max(120).optional(),
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
  const now = Math.floor(Date.now() / 1000);
  try {
    const picked = getLlmFor(db, "chat", parsed.data.model);
    if (!picked) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
    assertWithinBudget(db, now, getEnv().TZ);
    const config = getAiConfig(db);
    const llm = trackRuns(db, picked.llm, {
      feature: "chat",
      model: picked.model,
      trigger: "manual",
      subject: "ask",
      entry: picked.entry,
    });
    const answer = await answerQuestion(
      {
        db,
        llm,
        model: picked.model,
        includeBalances: config.includeBalances,
        now,
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
