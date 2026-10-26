import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deleteThread, getThread, renameThread } from "@/lib/ai/assistant";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

type Ctx = { params: Promise<{ id: string }> };

/** A conversation: its messages and the proposals made in it (with fresh status). */
export async function GET(_request: Request, { params }: Ctx) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json(getThread(getDb(), id.data, getEnv().TZ));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  const body = z.object({ title: z.string() }).safeParse(await readJson(request));
  if (!id.success || !body.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    renameThread(getDb(), id.data, body.data.title);
    return NextResponse.json({ ok: true });
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
    deleteThread(getDb(), id.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
