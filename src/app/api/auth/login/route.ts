import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { clientIp, createSession, loginLimiters, verifyPassword } from "@/lib/auth";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export const dynamic = "force-dynamic";

const body = z.object({ password: z.string().min(1).max(500) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const hash = getSetting(getDb(), SETTING_KEYS.passwordHash);
  if (!hash) return NextResponse.json({ error: "setup_required" }, { status: 409 });

  const { perIp, global } = loginLimiters();
  const ip = clientIp(request.headers);
  const blocked = [perIp.check(ip), global.check("*")].find((r) => !r.allowed);
  if (blocked) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: Math.ceil(blocked.retryAfterMs / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(blocked.retryAfterMs / 1000)) } },
    );
  }

  if (!(await verifyPassword(hash, parsed.data.password))) {
    perIp.fail(ip);
    global.fail("*");
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  perIp.reset(ip);
  await createSession();
  return NextResponse.json({ ok: true });
}
