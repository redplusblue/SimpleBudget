import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { plainEnglishFilters } from "@/lib/ai/nl-search";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { filtersToSearchParams } from "@/lib/finance/transaction-params";
import { getLlmFor } from "@/lib/llm";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";

export const dynamic = "force-dynamic";

const body = z.object({ text: z.string().trim().min(1, "Ask something").max(300) });

/**
 * Turns a plain-English question into transaction filters. Only the question and the names of your categories and
 * tags are sent; no transactions. The register applies the result as ordinary, editable filters.
 */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const { text } = body.parse(await readJson(request));
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const timeZone = getEnv().TZ;
    const picked = getLlmFor(db, "search"); // no picker: the default from settings
    if (!picked) return NextResponse.json({ error: "ai_disabled", message: "AI is turned off." }, { status: 409 });
    assertWithinBudget(db, now, timeZone);
    const llm = trackRuns(db, picked.llm, {
      feature: "search",
      model: picked.model,
      trigger: "manual",
      subject: "search",
      entry: picked.entry,
    });
    const result = await plainEnglishFilters({ db, llm, now, timeZone }, text);
    if (!result)
      return NextResponse.json(
        { error: "not_understood", message: "I couldn't turn that into a search. Try rephrasing it." },
        { status: 422 },
      );
    return NextResponse.json({
      filters: result.filters,
      params: filtersToSearchParams(result.filters).toString(),
      dropped: result.dropped,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
