import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { dismissProposal } from "@/lib/ai/proposals";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    dismissProposal(getDb(), id.data, Math.floor(Date.now() / 1000));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
