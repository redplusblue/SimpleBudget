import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { deleteRule, getRule, setRuleEnabled, updateRule } from "@/lib/rules/store";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

/** Replaces a rule's definition. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json({ rule: updateRule(getDb(), id.data, await readJson(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Toggles a rule on or off: `{ enabled: boolean }`. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  const body = z.object({ enabled: z.boolean() }).safeParse(await readJson(request));
  if (!id.success || !body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    setRuleEnabled(getDb(), id.data, body.data.enabled);
    return NextResponse.json({ rule: getRule(getDb(), id.data) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (!deleteRule(getDb(), id.data)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
