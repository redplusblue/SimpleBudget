import "server-only";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { logger } from "@/lib/logger";
import { getSetting, setSetting } from "@/lib/settings";
import { DISPLAY_CURRENCY } from "./currency";
import type { DisplayCurrencyState } from "./display-currency-types";

/**
 * Daily market rates, display only. Fixed HTTPS URL (never user supplied), keyless and free; it publishes once a day.
 * Stored amounts stay in US dollars: these rates only change how a number is drawn on screen.
 */
export const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const MARKET_KEY = "fx:market";
const ENABLED_KEY = "display:currency_enabled";
const CODE_KEY = "display:currency";
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;

const marketSchema = z.object({
  updatedAt: z.number().int().positive(),
  /** Units of the currency per 1 US dollar. */
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().finite().max(1e9)),
});
export type MarketRates = z.infer<typeof marketSchema>;

const apiSchema = z.object({
  result: z.literal("success"),
  base_code: z.literal("USD"),
  rates: z.record(z.string(), z.unknown()),
});

export class ExchangeRateError extends Error {}

/** Keeps only well-formed positive rates, and refuses a response that looks truncated or wrong. */
export function parseMarketRates(body: unknown, now: number): MarketRates {
  const api = apiSchema.safeParse(body);
  if (!api.success) throw new ExchangeRateError("Unexpected response from the rates service");
  const rates: Record<string, number> = {};
  for (const [code, v] of Object.entries(api.data.rates)) {
    if (/^[A-Z]{3}$/.test(code) && typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1e9) rates[code] = v;
  }
  rates[DISPLAY_CURRENCY] = 1;
  // A real response has ~160 currencies and these majors; anything less is not trustworthy enough to replace good data.
  if (Object.keys(rates).length < 30 || !rates.EUR || !rates.GBP || !rates.INR)
    throw new ExchangeRateError("The rates service returned too little data");
  return { updatedAt: now, rates };
}

export function getMarketRates(db: DbLike): MarketRates | null {
  const raw = getSetting(db, MARKET_KEY);
  if (!raw) return null;
  try {
    const parsed = marketSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Downloads and stores today's rates. On any failure the previous rates are kept untouched. */
export async function refreshMarketRates(
  db: DbLike,
  now = Math.floor(Date.now() / 1000),
  fetchImpl: typeof fetch = fetch,
): Promise<MarketRates> {
  let body: unknown;
  try {
    const res = await fetchImpl(RATES_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new ExchangeRateError(`The rates service answered ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new ExchangeRateError("The rates response was too large");
    body = JSON.parse(text);
  } catch (err) {
    if (err instanceof ExchangeRateError) throw err;
    throw new ExchangeRateError("Couldn't reach the rates service");
  }
  const market = parseMarketRates(body, now);
  setSetting(db, MARKET_KEY, JSON.stringify(market));
  return market;
}

/** Logs instead of throwing: the scheduler and boot catch-up must never crash the server. */
export async function refreshMarketRatesSafe(db: DbLike): Promise<boolean> {
  try {
    const m = await refreshMarketRates(db);
    logger.info({ currencies: Object.keys(m.rates).length }, "exchange rates updated");
    return true;
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : "unknown" },
      "exchange rate update failed; keeping old rates",
    );
    return false;
  }
}

/** The display preference plus the rate in force. Falls back to dollars whenever the rate is missing. */
export function getDisplayCurrency(db: DbLike): DisplayCurrencyState {
  const market = getMarketRates(db);
  const enabled = getSetting(db, ENABLED_KEY) === "true";
  const chosen = getSetting(db, CODE_KEY) ?? DISPLAY_CURRENCY;
  const rate = market?.rates[chosen];
  const usable = enabled && rate !== undefined;
  return {
    enabled,
    code: usable ? chosen : DISPLAY_CURRENCY,
    rate: usable ? rate : 1,
    updatedAt: market?.updatedAt ?? null,
    available: market ? Object.keys(market.rates).sort() : [],
  };
}

const prefSchema = z.object({
  enabled: z.boolean().optional(),
  code: z
    .string()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code")
    .optional(),
});

export function setDisplayCurrency(db: DbLike, input: unknown): DisplayCurrencyState {
  const pref = prefSchema.parse(input);
  if (pref.code !== undefined) {
    // Only currencies we actually have a rate for can be chosen.
    if (!getMarketRates(db)?.rates[pref.code]) throw new ExchangeRateError(`No exchange rate for ${pref.code} yet`);
    setSetting(db, CODE_KEY, pref.code);
  }
  if (pref.enabled !== undefined) setSetting(db, ENABLED_KEY, String(pref.enabled));
  return getDisplayCurrency(db);
}
