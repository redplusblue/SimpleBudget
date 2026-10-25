import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { reorderCategories } from "@/lib/finance/taxonomy-admin";

export const dynamic = "force-dynamic";

const body = z.object({ ids: z.array(z.number().int().positive()).max(500) });

export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    reorderCategories(getDb(), parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
