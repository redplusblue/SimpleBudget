import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getSplits, setSplits } from "@/lib/finance/splits";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  return NextResponse.json({ splits: getSplits(getDb(), id.data) });
}

/** `{ parts: [{ categoryId, amountCents, notes? }] }`; parts must add up to the amount. An empty list removes the split. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json({ splits: setSplits(getDb(), id.data, await readJson(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}
