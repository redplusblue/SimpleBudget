import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { removeConnection } from "@/lib/connections";

export const dynamic = "force-dynamic";

const idSchema = z.coerce.number().int().positive();

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const deleteData = new URL(request.url).searchParams.get("deleteData") === "true";
  if (!removeConnection(getDb(), id.data, { deleteData })) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
