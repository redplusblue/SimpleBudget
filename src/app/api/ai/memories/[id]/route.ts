import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { deleteMemory, memoryText, updateMemory } from "@/lib/ai/memory";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();
const patch = z.object({ text: memoryText, enabled: z.boolean() }).partial().strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json({ memory: updateMemory(getDb(), id.data, patch.parse(await readJson(request))) });
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
    deleteMemory(getDb(), id.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
