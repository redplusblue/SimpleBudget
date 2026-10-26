import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { PROPOSAL_KINDS, PROPOSAL_STATUSES } from "@/db/schema";
import { listProposalViews } from "@/lib/ai/proposals";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const query = z.object({
  kind: z.enum(PROPOSAL_KINDS).default("rule"),
  status: z.enum(PROPOSAL_STATUSES).default("pending"),
});

/** The AI's proposals (default: pending rule suggestions) with fresh previews. */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const q = query.parse(Object.fromEntries(searchParams));
    const status =
      q.status === "dismissed" ? (["dismissed", "no_match"] satisfies ("dismissed" | "no_match")[]) : q.status;
    return NextResponse.json({ proposals: listProposalViews(getDb(), { kind: q.kind, status }, getEnv().TZ) });
  } catch (e) {
    return errorResponse(e);
  }
}
