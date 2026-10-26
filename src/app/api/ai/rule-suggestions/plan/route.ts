import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getRuleSuggestSettings } from "@/lib/ai/rule-settings";
import { planSuggestions } from "@/lib/ai/rule-suggestions";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { AiConfigError, findModel, getAiConfig, isAllowedModel, modelFor } from "@/lib/llm/config";

export const dynamic = "force-dynamic";

/** What a run would do (merchants, requests, tokens, cost if prices are known). Free: no model is called. */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const db = getDb();
    const cfg = getAiConfig(db);
    const model = new URL(request.url).searchParams.get("model")?.trim() || modelFor(cfg, "rules");
    if (model && !isAllowedModel(cfg, model)) throw new AiConfigError("That model isn't in your model list.");
    // The merchant list itself stays on the server.
    const { groups: _groups, ...plan } = planSuggestions(db, {
      maxMerchants: getRuleSuggestSettings(db).maxMerchantsPerRun,
      entry: findModel(cfg, model),
    });
    void _groups;
    return NextResponse.json(plan);
  } catch (e) {
    return errorResponse(e);
  }
}
