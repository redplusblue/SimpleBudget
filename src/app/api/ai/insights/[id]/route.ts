import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { updateInsightCard } from "@/lib/ai/insight-cards";
import { readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const patch = z.object({ pinned: z.boolean(), dismissed: z.boolean() }).partial().strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  const body = patch.safeParse(await readJson(request));
  if (!id.success || !body.success || Object.keys(body.data).length === 0)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const card = updateInsightCard(getDb(), id.data, body.data, Math.floor(Date.now() / 1000));
  if (!card) return NextResponse.json({ error: "not_found", message: "Card not found" }, { status: 404 });
  return NextResponse.json({ card });
}
