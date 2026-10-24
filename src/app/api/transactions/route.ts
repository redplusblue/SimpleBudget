import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { bulkPatchSchema } from "@/lib/finance/transaction-schemas";
import { pagingQuerySchema, parseFilterParams } from "@/lib/finance/transaction-params";
import { InvalidCursorError, queryTransactions } from "@/lib/finance/transactions-query";
import { bulkUpdateTransactions, UpdateError } from "@/lib/finance/transactions-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const filters = parseFilterParams(params);
  const paging = pagingQuerySchema.safeParse(Object.fromEntries(params.entries()));
  if (!filters.ok || !paging.success) {
    return NextResponse.json(
      { error: "invalid_request", message: filters.ok ? "Invalid paging" : filters.error },
      { status: 400 },
    );
  }
  try {
    const page = queryTransactions(getDb(), filters.filters, { ...paging.data, timeZone: getEnv().TZ });
    return NextResponse.json(page);
  } catch (e) {
    if (e instanceof InvalidCursorError)
      return NextResponse.json({ error: "invalid_request", message: e.message }, { status: 400 });
    throw e;
  }
}

/** Bulk edit: { ids, patch }. */
export async function PATCH(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = bulkPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request", message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const updated = bulkUpdateTransactions(getDb(), parsed.data.ids, parsed.data.patch);
    return NextResponse.json({ updated });
  } catch (e) {
    if (e instanceof UpdateError)
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.code === "not_found" ? 404 : 400 });
    throw e;
  }
}
