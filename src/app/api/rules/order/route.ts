import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { reorderRules } from "@/lib/rules/store";

export const dynamic = "force-dynamic";

const body = z.object({ ids: z.array(z.number().int().positive()).max(1000) });

/** Sets rule priority: the first id runs first. */
export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    reorderRules(getDb(), parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
