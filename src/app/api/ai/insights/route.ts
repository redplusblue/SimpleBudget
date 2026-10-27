import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { generateInsightCards, listInsightCards } from "@/lib/ai/insight-cards";
import { benchmarkFacts, getBenchmarks } from "@/lib/ai/web-research";
import { LENS_IDS } from "@/lib/ai/lenses";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getLlmFor } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";

export const dynamic = "force-dynamic";

/** Saved cards: pinned first, newest batches next, dismissed ones left out. */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const limit = z.coerce.number().int().min(1).max(100).catch(30).parse(new URL(request.url).searchParams.get("limit"));
  return NextResponse.json({ cards: listInsightCards(getDb(), limit) });
}

const body = z.object({
  lens: z.enum([...LENS_IDS, "all"]).default("all"),
  model: z.string().trim().min(1).max(120).optional(),
  count: z.number().int().min(1).max(6).optional(),
  /** Compare with public data (only does anything while web research is switched on in settings). */
  web: z.boolean().optional(),
});

/** Generates a batch of cards from computed facts. Costs money when there is something to say; manual only. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const input = body.parse((await readJson(request)) ?? {});
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const timeZone = getEnv().TZ;
    const picked = getLlmFor(db, "insights", input.model);
    if (!picked) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
    assertWithinBudget(db, now, timeZone);
    const config = getAiConfig(db);
    const llm = trackRuns(db, picked.llm, {
      feature: "insights",
      model: picked.model,
      trigger: "manual",
      subject: `cards:${input.lens}`,
      entry: picked.entry,
    });
    // Public benchmarks come from a separate, generic research request; the card request itself makes no web call.
    const extraFacts = input.web
      ? benchmarkFacts(await getBenchmarks({ db, cfg: config, now, timeZone }, input.lens))
      : [];
    const cards = await generateInsightCards(
      {
        db,
        llm,
        model: picked.model,
        runId: llm.lastRunId,
        now,
        timeZone,
        includeBalances: config.includeBalances,
        userName: config.userName,
      },
      { lens: input.lens, count: input.count, extraFacts },
    );
    return NextResponse.json({ cards });
  } catch (e) {
    return errorResponse(e);
  }
}
