import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { chat, getThreadOrThrow, MAX_TEXT_CHARS } from "@/lib/ai/assistant";
import { LENS_IDS } from "@/lib/ai/lenses";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getLlmFor } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";

export const dynamic = "force-dynamic";

const body = z.object({
  threadId: z.number().int().positive().optional(),
  lens: z.enum(LENS_IDS).default("general"),
  text: z.string().trim().min(1, "Write a message").max(MAX_TEXT_CHARS),
  model: z.string().trim().min(1).max(120).optional(),
});

/**
 * One chat turn, streamed as newline-delimited JSON ChatEvents:
 * thread, text (pieces), proposal, then done or error.
 */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const timeZone = getEnv().TZ;
  let input: z.infer<typeof body>;
  let picked;
  try {
    input = body.parse(await readJson(request));
    if (input.threadId) getThreadOrThrow(db, input.threadId);
    picked = getLlmFor(db, "chat", input.model);
    if (picked) assertWithinBudget(db, now, timeZone);
  } catch (e) {
    return errorResponse(e);
  }
  if (!picked) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
  const config = getAiConfig(db);
  const llm = trackRuns(db, picked.llm, {
    feature: "chat",
    model: picked.model,
    trigger: "manual",
    subject: `lens:${input.lens}`,
    entry: picked.entry,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await chat(
          {
            db,
            llm,
            model: picked.model,
            runId: llm.lastRunId,
            now,
            timeZone,
            includeBalances: config.includeBalances,
          },
          { threadId: input.threadId, lens: input.lens, text: input.text },
          send,
        );
      } catch (e) {
        logger.error({ err: e }, "assistant chat failed");
        send({ type: "error", message: "Something went wrong answering that." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
