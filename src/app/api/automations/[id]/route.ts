import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { rescheduleAutomations } from "@/lib/automations/scheduler";
import { deleteAutomation, getAutomation, setAutomationEnabled, updateAutomation } from "@/lib/automations/store";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();
const toggle = z.object({ enabled: z.boolean() }).strict();
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json({ automation: getAutomation(getDb(), id.data) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** `{ enabled }` alone switches it on or off; anything else replaces the whole definition. */
export async function PATCH(request: Request, { params }: Ctx) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const body = (await readJson(request)) ?? {};
    const onlyToggle = toggle.safeParse(body);
    const automation = onlyToggle.success
      ? setAutomationEnabled(getDb(), id.data, onlyToggle.data.enabled)
      : updateAutomation(getDb(), id.data, body);
    rescheduleAutomations();
    return NextResponse.json({ automation });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    deleteAutomation(getDb(), id.data);
    rescheduleAutomations();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
