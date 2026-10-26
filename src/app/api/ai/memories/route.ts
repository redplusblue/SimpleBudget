import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addMemory, listMemories, memoryText } from "@/lib/ai/memory";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ memories: listMemories(getDb()) });
}

/** Adds something the AI should always know. Sent with every AI request. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const body = z.object({ text: memoryText }).parse(await readJson(request));
    return NextResponse.json({ memory: addMemory(getDb(), body.text, "user") }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
