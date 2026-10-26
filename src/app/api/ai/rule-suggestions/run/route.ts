import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { isRuleRunRunning, runExclusive } from "@/lib/ai/rule-runner";
import { getRuleSuggestSettings } from "@/lib/ai/rule-settings";
import { planSuggestions, suggestRules } from "@/lib/ai/rule-suggestions";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getLlmFor } from "@/lib/llm";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";

export const dynamic = "force-dynamic";

const body = z.object({ model: z.string().trim().min(1).max(120).optional() });

/** Asks the model about merchants no rule covers and stores the answers as suggestions. Costs money: manual only. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const input = body.parse((await readJson(request)) ?? {});
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const timeZone = getEnv().TZ;
    const picked = getLlmFor(db, "rules", input.model);
    if (!picked) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
    assertWithinBudget(db, now, timeZone);
    if (isRuleRunRunning())
      return NextResponse.json({ error: "busy", message: "A suggestion run is already in progress." }, { status: 409 });

    const { maxMerchantsPerRun } = getRuleSuggestSettings(db);
    const result = await runExclusive(async () => {
      const plan = planSuggestions(db, { maxMerchants: maxMerchantsPerRun });
      const llm = trackRuns(db, picked.llm, {
        feature: "rules",
        model: picked.model,
        trigger: "manual",
        subject: `${plan.toSend} merchants`,
        entry: picked.entry,
      });
      return suggestRules(
        { db, llm, model: picked.model, runId: llm.lastRunId, now, timeZone },
        { maxMerchants: maxMerchantsPerRun },
      );
    });
    if (result === null)
      return NextResponse.json({ error: "busy", message: "A suggestion run is already in progress." }, { status: 409 });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
