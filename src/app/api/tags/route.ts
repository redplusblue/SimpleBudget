import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { findOrCreateTag, listTags, MAX_TAG_LENGTH } from "@/lib/finance/taxonomy";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ tags: listTags(getDb()) });
}

const body = z.object({ name: z.string().trim().min(1).max(MAX_TAG_LENGTH) });

/** Creates a tag, or returns the existing one with the same name. */
export async function POST(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid_request", message: `Tag names must be 1-${MAX_TAG_LENGTH} characters` },
      { status: 400 },
    );
  return NextResponse.json({ tag: findOrCreateTag(getDb(), parsed.data.name) }, { status: 201 });
}
