import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { listThreads } from "@/lib/ai/assistant";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ threads: listThreads(getDb()) });
}
