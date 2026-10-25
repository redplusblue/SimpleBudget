import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { createManualAccount } from "@/lib/finance/manual";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const rows = getDb().select().from(accounts).orderBy(accounts.sortOrder, accounts.orgName, accounts.name).all();
  return NextResponse.json({ accounts: rows });
}

/** Creates an offline (manual) account: `{ name, type?, balanceCents? }`. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const id = createManualAccount(getDb(), await readJson(request), Math.floor(Date.now() / 1000), getEnv().TZ);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
