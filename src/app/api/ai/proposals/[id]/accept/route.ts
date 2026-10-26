import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { acceptRuleProposal } from "@/lib/ai/proposals";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const body = z
  .object({ categoryId: z.number().int().positive().optional(), applyExisting: z.boolean().default(true) })
  .strict();

/** Accepts a suggestion: creates or extends the rule, optionally categorizing existing matches. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const input = body.parse((await readJson(request)) ?? {});
    return NextResponse.json(acceptRuleProposal(getDb(), id.data, input, Math.floor(Date.now() / 1000)));
  } catch (e) {
    return errorResponse(e);
  }
}
