import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { currentMonth } from "@/lib/finance/dates";
import { logger } from "@/lib/logger";
import { getLlm } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { generateSummary, getCachedSummary } from "@/lib/llm/narrative";
import { LlmError } from "@/lib/llm/types";

export const dynamic = "force-dynamic";

/** The saved monthly summary, if any (and whether AI is on at all). */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const config = getAiConfig(db);
  return NextResponse.json({
    enabled: config.enabled,
    summary: config.enabled ? getCachedSummary(db, currentMonth(now, getEnv().TZ)) : null,
  });
}

/**
 * Generates a fresh summary and streams it as newline-delimited JSON:
 * {"type":"text","text":"..."} pieces, then {"type":"done","createdAt":...} or {"type":"error","message":"..."}.
 */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const db = getDb();
  const llm = getLlm(db);
  if (!llm) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
  const config = getAiConfig(db);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await generateSummary(
          {
            db,
            llm,
            model: config.model,
            includeBalances: config.includeBalances,
            now: Math.floor(Date.now() / 1000),
            timeZone: getEnv().TZ,
          },
          (text) => send({ type: "text", text }),
        );
        send({ type: "done", createdAt: result.createdAt });
      } catch (e) {
        if (!(e instanceof LlmError)) logger.error({ err: e }, "summary failed");
        send({ type: "error", message: e instanceof LlmError ? e.message : "Couldn't write the summary." });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // The client went away; the in-flight provider request finishes on its own.
    },
  });
  void request;
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
