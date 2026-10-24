import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { completeSetup } from "@/lib/setup";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  if (completeSetup(getDb()) === "no-connection") {
    return NextResponse.json({ error: "no_connection", message: "Connect SimpleFIN first" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
