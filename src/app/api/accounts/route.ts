import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { accounts } from "@/db/schema";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const rows = getDb().select().from(accounts).orderBy(accounts.sortOrder, accounts.orgName, accounts.name).all();
  return NextResponse.json({ accounts: rows });
}
