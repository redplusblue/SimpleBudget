import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getAccountsOverview } from "@/lib/finance/accounts-overview";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const includeHidden = new URL(request.url).searchParams.get("includeHidden") === "true";
  const groups = getAccountsOverview(getDb(), Math.floor(Date.now() / 1000), getEnv().TZ, includeHidden);
  return NextResponse.json({ groups });
}
