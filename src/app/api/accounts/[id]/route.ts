import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ACCOUNT_TYPES, accounts } from "@/db/schema";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { getAccountDetail } from "@/lib/finance/accounts-overview";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const { id } = await params;
  const detail = getAccountDetail(getDb(), decodeURIComponent(id), Math.floor(Date.now() / 1000), getEnv().TZ);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}

/** Only user-overlay columns can be edited; imported bank fields are read-only. */
const patch = z
  .object({
    displayName: z.string().trim().max(120).nullable(),
    type: z.enum(ACCOUNT_TYPES),
    isHidden: z.boolean(),
    isClosed: z.boolean(),
    excludeFromNetWorth: z.boolean(),
    creditLimitCents: z.number().int().min(1).max(100_000_000_00).nullable(),
    lowBalanceCents: z.number().int().min(0).max(100_000_000_00).nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const parsed = patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const { id } = await params;
  const db = getDb();
  const updated = db
    .update(accounts)
    .set({
      ...parsed.data,
      displayName: parsed.data.displayName === "" ? null : parsed.data.displayName,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(accounts.id, decodeURIComponent(id)))
    .returning()
    .get();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ account: updated });
}
