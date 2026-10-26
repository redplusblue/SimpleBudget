import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { explainTrace } from "@/lib/ai/trace-explain";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getTransactionDetail } from "@/lib/finance/transactions-query";
import { logger } from "@/lib/logger";
import { getLlmFor } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";
import { aiRuns } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const body = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  question: z.string().trim().max(500).optional(),
});

/** "Explain with AI" for one transaction: streams NDJSON text / proposal / done / error. Pressed by the owner. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const timeZone = getEnv().TZ;
  let input: z.infer<typeof body>;
  let picked;
  try {
    input = body.parse((await readJson(request)) ?? {});
    if (!getTransactionDetail(db, id.data, timeZone))
      return NextResponse.json({ error: "not_found", message: "Transaction not found" }, { status: 404 });
    picked = getLlmFor(db, "trace", input.model);
    if (picked) assertWithinBudget(db, now, timeZone);
  } catch (e) {
    return errorResponse(e);
  }
  if (!picked) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
  const config = getAiConfig(db);
  const llm = trackRuns(db, picked.llm, {
    feature: "trace",
    model: picked.model,
    trigger: "manual",
    subject: "txn",
    entry: picked.entry,
  });
  const costOf = () => {
    const runId = llm.lastRunId();
    return runId === null
      ? null
      : (db.select({ c: aiRuns.costMicros }).from(aiRuns).where(eq(aiRuns.id, runId)).get()?.c ?? null);
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await explainTrace(
          {
            db,
            llm,
            model: picked.model,
            runId: llm.lastRunId,
            now,
            timeZone,
            includeBalances: config.includeBalances,
          },
          id.data,
          input.question,
          send,
          costOf,
        );
      } catch (e) {
        logger.error({ err: e }, "trace explain failed");
        send({ type: "error", message: "Something went wrong explaining that." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
