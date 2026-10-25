import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getHoldings } from "@/lib/finance/holdings";

export const dynamic = "force-dynamic";

/** The positions SimpleFIN reports for an investment account (empty list when the bank sends none). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json(getHoldings(getDb(), decodeURIComponent((await params).id)));
}
