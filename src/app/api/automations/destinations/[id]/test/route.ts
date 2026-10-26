import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sendTo } from "@/lib/automations/destinations";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Sends a fixed, harmless test message. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const res = await sendTo(getDb(), id.data, {
    event: "test",
    title: "SimpleBudget test",
    message: "If you can read this, this destination works.",
  });
  if (!res.ok)
    return NextResponse.json(
      {
        error: "delivery_failed",
        message: res.status ? `The server answered with an error (${res.status}).` : "Couldn't reach that address.",
      },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}
