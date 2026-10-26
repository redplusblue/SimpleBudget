import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createDestination, listDestinations } from "@/lib/automations/destinations";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Destinations never include their address or token, only the host. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ destinations: listDestinations(getDb()) });
}

export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json({ destination: createDestination(getDb(), await readJson(request)) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
