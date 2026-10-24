import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { createSession, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth";
import { createInitialPassword } from "@/lib/setup";

export const dynamic = "force-dynamic";

const body = z.object({
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH),
});

/** First-run only: public, but refuses once a password exists. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const created = createInitialPassword(getDb(), await hashPassword(parsed.data.password));
  if (!created) return NextResponse.json({ error: "already_configured" }, { status: 409 });
  await createSession();
  return NextResponse.json({ ok: true });
}
