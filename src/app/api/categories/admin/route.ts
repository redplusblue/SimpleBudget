import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { listCategoriesAdmin } from "@/lib/finance/taxonomy-admin";

export const dynamic = "force-dynamic";

/** Categories with how many transactions use each, for the settings page. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ categories: listCategoriesAdmin(getDb()) });
}
