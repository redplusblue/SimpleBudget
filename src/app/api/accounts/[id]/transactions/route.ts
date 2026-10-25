import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { createManualTransaction } from "@/lib/finance/manual";

export const dynamic = "force-dynamic";

/** Adds a transaction to a manual account: `{ date, amountCents, description, categoryId?, notes? }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const id = createManualTransaction(
      getDb(),
      decodeURIComponent((await params).id),
      await readJson(request),
      Math.floor(Date.now() / 1000),
      getEnv().TZ,
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
