import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { forgetProposal } from "@/lib/ai/proposals";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Forgets a dismissed or no_match suggestion so the merchant can be asked about again. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    forgetProposal(getDb(), id.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
