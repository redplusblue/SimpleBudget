import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getTransactionRows } from "@/lib/finance/transactions-query";
import { previewRule } from "@/lib/rules/store";

export const dynamic = "force-dynamic";

const body = z.object({ rule: z.unknown(), overwrite: z.boolean().default(false) });

/** "Matches N existing transactions" for a rule that may not be saved yet. Nothing is changed. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const db = getDb();
    const result = previewRule(db, parsed.data.rule as never, { overwrite: parsed.data.overwrite, sample: 8 });
    return NextResponse.json({
      matched: result.matched,
      changed: result.changed,
      sample: getTransactionRows(db, result.sampleIds),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
