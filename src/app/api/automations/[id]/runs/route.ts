import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getAutomation, listRuns } from "@/lib/automations/store";
import { errorResponse } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** The last 50 runs: status, a plain reason and the first 200 characters of what was sent. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    getAutomation(getDb(), id.data);
    return NextResponse.json({ runs: listRuns(getDb(), id.data) });
  } catch (e) {
    return errorResponse(e);
  }
}
