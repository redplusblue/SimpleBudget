import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { traceTransaction } from "@/lib/finance/trace";

export const dynamic = "force-dynamic";

/** The merchant's whole history for this transaction, computed locally. No AI involved. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const trace = traceTransaction(getDb(), id.data, Math.floor(Date.now() / 1000), getEnv().TZ);
  if (!trace) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ trace });
}
