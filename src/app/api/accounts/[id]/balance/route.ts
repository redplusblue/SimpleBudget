import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { setManualBalance } from "@/lib/finance/manual";

export const dynamic = "force-dynamic";

const body = z.object({ balanceCents: z.number().int() });

/** Sets what a manual account holds right now. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request", message: "Enter a balance" }, { status: 400 });
  try {
    setManualBalance(
      getDb(),
      decodeURIComponent((await params).id),
      parsed.data.balanceCents,
      Math.floor(Date.now() / 1000),
      getEnv().TZ,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
