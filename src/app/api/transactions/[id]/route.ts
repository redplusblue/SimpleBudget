import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { transactionPatchSchema } from "@/lib/finance/transaction-schemas";
import { getTransactionDetail } from "@/lib/finance/transactions-query";
import { UpdateError, updateTransaction } from "@/lib/finance/transactions-update";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const detail = getTransactionDetail(getDb(), id.data);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ transaction: detail });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  const patch = transactionPatchSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !patch.success) {
    return NextResponse.json(
      { error: "invalid_request", message: patch.success ? undefined : patch.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const db = getDb();
  try {
    updateTransaction(db, id.data, patch.data);
  } catch (e) {
    if (e instanceof UpdateError)
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === "not_found" ? 404 : 400 });
    throw e;
  }
  return NextResponse.json({ transaction: getTransactionDetail(db, id.data) });
}
