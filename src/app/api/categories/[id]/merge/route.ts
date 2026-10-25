import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { mergeCategories } from "@/lib/finance/taxonomy-admin";

export const dynamic = "force-dynamic";

const body = z.object({ intoId: z.number().int().positive() });

/** Moves all of this category's transactions into another category and deletes this one. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  const parsed = body.safeParse(await readJson(request));
  if (!id.success || !parsed.success)
    return NextResponse.json({ error: "invalid_request", message: "Choose a category to merge into" }, { status: 400 });
  try {
    return NextResponse.json(mergeCategories(getDb(), id.data, parsed.data.intoId));
  } catch (e) {
    return errorResponse(e);
  }
}
