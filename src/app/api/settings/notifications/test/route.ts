import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getNotifyTarget } from "@/lib/notify/config";
import { sendNotification } from "@/lib/notify/send";

export const dynamic = "force-dynamic";

/** Sends a harmless test message to the saved destination. */
export async function POST() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  let target;
  try {
    target = getNotifyTarget(getDb());
  } catch {
    return NextResponse.json(
      { error: "unreadable", message: "The saved address couldn't be read. Enter it again." },
      { status: 409 },
    );
  }
  if (!target)
    return NextResponse.json(
      { error: "not_configured", message: "Add where notifications should go first." },
      { status: 409 },
    );
  const res = await sendNotification(target, {
    event: "test",
    title: "SimpleBudget test",
    message: "If you can read this, notifications work.",
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
