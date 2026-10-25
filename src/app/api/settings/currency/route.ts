import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api-errors";
import { requireApiAuth } from "@/lib/auth";
import { foreignCurrencies, setRates } from "@/lib/finance/currency";

export const dynamic = "force-dynamic";

/** The non-dollar currencies your accounts use, and the rate saved for each. */
export async function GET() {
  const denied = await requireApiAuth();
  if (denied) return denied;
  return NextResponse.json({ currencies: foreignCurrencies(getDb()) });
}

/** `{ rates: { EUR: 1.0856 } }`: 1 unit of the currency in US dollars. */
export async function PUT(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  try {
    const body = (await readJson(request)) as { rates?: unknown } | null;
    setRates(getDb(), body?.rates ?? {});
    return NextResponse.json({ currencies: foreignCurrencies(getDb()) });
  } catch (e) {
    return errorResponse(e);
  }
}
