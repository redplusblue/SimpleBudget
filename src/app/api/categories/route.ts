import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { listCategories } from "@/lib/finance/taxonomy";
import { createCategory } from "@/lib/finance/taxonomy-admin";

export const dynamic = "force-dynamic";

/** All categories (archived ones flagged), for pickers and for naming the category a row is filed under. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ categories: listCategories(getDb()) });
}

export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ category: createCategory(getDb(), await readJson(request)) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
