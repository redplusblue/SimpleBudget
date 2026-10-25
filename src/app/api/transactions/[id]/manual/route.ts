import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { deleteManualTransaction, updateManualTransaction } from "@/lib/finance/manual";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

/** Edits the core fields (date, amount, description) of a transaction you added by hand. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    updateManualTransaction(getDb(), id.data, await readJson(request), Math.floor(Date.now() / 1000), getEnv().TZ);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    deleteManualTransaction(getDb(), id.data, Math.floor(Date.now() / 1000), getEnv().TZ);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
