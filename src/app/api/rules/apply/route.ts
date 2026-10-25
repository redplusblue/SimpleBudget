import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { applyRules, getRule, RuleError } from "@/lib/rules/store";

export const dynamic = "force-dynamic";

const body = z.object({
  ruleId: z.number().int().positive().optional(),
  overwrite: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

/**
 * Runs one rule (`ruleId`) or every enabled rule over existing transactions. By default only empty fields are
 * filled; `overwrite: true` lets rules replace values that are already set.
 * `dryRun: true` only reports how many transactions would change.
 */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const db = getDb();
    let rules;
    if (parsed.data.ruleId !== undefined) {
      const rule = getRule(db, parsed.data.ruleId);
      if (!rule) throw new RuleError("not_found", "Rule not found");
      rules = [rule];
    }
    const { matched, changed } = applyRules(db, {
      rules,
      overwrite: parsed.data.overwrite,
      dryRun: parsed.data.dryRun,
    });
    return NextResponse.json({ matched, changed });
  } catch (e) {
    return errorResponse(e);
  }
}
