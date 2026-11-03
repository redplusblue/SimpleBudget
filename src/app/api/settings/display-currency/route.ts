import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { ExchangeRateError, getDisplayCurrency, setDisplayCurrency } from "@/lib/finance/exchange-rates";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json(getDisplayCurrency(getDb()));
}

/** `{ enabled?: boolean, code?: "INR" }` */
export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    return NextResponse.json(setDisplayCurrency(getDb(), await readJson(request)));
  } catch (e) {
    if (e instanceof ExchangeRateError)
      return NextResponse.json({ error: "invalid", message: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
