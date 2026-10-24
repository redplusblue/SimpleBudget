import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { addConnection, listConnections } from "@/lib/connections";
import { claimSetupToken, SimpleFinError, type SimpleFinErrorCode } from "@/lib/simplefin/client";

export const dynamic = "force-dynamic";

const STATUS: Record<SimpleFinErrorCode, number> = {
  invalid_token: 400,
  already_claimed: 409,
  revoked: 409,
  rate_limited: 429,
  server: 502,
  network: 502,
  bad_response: 502,
};

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ connections: listConnections(getDb()) });
}

const body = z.object({ setupToken: z.string().min(1).max(2000) });

export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", message: "Paste your SimpleFIN setup token." },
      { status: 400 },
    );
  }

  try {
    const accessUrl = await claimSetupToken(parsed.data.setupToken);
    const id = addConnection(getDb(), accessUrl);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    if (err instanceof SimpleFinError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: STATUS[err.code] });
    }
    // Deliberately not logging the error object: it could carry the access URL.
    return NextResponse.json({ error: "internal", message: "Couldn't save the connection." }, { status: 500 });
  }
}
