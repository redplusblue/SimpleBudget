import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { ExchangeRateError, getDisplayCurrency, refreshMarketRates } from "@/lib/finance/exchange-rates";

export const dynamic = "force-dynamic";

/** Fetches today's rates now instead of waiting for the daily job. Takes no input, so nothing can steer the request. */
export async function POST() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    await refreshMarketRates(getDb());
    return NextResponse.json(getDisplayCurrency(getDb()));
  } catch (e) {
    if (e instanceof ExchangeRateError)
      return NextResponse.json({ error: "rates_unavailable", message: e.message }, { status: 502 });
    throw e;
  }
}
