import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { accounts } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

/** Everything is shown in US dollars; accounts in other currencies are converted at rates you set yourself. */
export const DISPLAY_CURRENCY = "USD";
const RATES_KEY = "fx:rates";

export type Rates = Record<string, number>;

export const ratesSchema = z.record(
  z.string().regex(/^[A-Z]{3}$/, "Use three-letter currency codes like EUR"),
  z
    .number()
    .positive("A rate must be above zero")
    .max(1_000_000, "That rate is too large")
    .refine((n) => Math.abs(n * 1e6 - Math.round(n * 1e6)) < 1e-6, "Use at most 6 decimal places"),
);

/** The saved rates (1 unit of the currency = `rate` US dollars). Anything unreadable counts as no rates. */
export function getRates(db: DbLike): Rates {
  const raw = getSetting(db, RATES_KEY);
  if (!raw) return {};
  try {
    const parsed = ratesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function setRates(db: DbLike, input: unknown): Rates {
  const rates = ratesSchema.parse(input);
  delete rates[DISPLAY_CURRENCY];
  setSetting(db, RATES_KEY, JSON.stringify(rates));
  return rates;
}

/** `cents` in `currency`, expressed in dollars. Without a rate the amount is counted as is (1 to 1). */
export function convertCents(cents: number, currency: string, rates: Rates): number {
  if (currency === DISPLAY_CURRENCY) return cents;
  const rate = rates[currency];
  return rate === undefined ? cents : Math.round(cents * rate);
}

export interface CurrencyUse {
  currency: string;
  accountCount: number;
  /** The saved rate, or null when none is set yet (the amounts are then counted 1 to 1). */
  rate: number | null;
}

/** The non-dollar currencies your accounts use, with how many accounts each and the rate in force. */
export function foreignCurrencies(db: DbLike): CurrencyUse[] {
  const rates = getRates(db);
  const counts = new Map<string, number>();
  for (const a of db.select({ currency: accounts.currency }).from(accounts).all()) {
    if (a.currency !== DISPLAY_CURRENCY) counts.set(a.currency, (counts.get(a.currency) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, accountCount]) => ({ currency, accountCount, rate: rates[currency] ?? null }));
}

/** Per-account multipliers for the given accounts, or undefined when every one of them is in dollars. */
export function scaleFor(db: DbLike, ids: string[]): Map<string, number> | undefined {
  if (ids.length === 0) return undefined;
  const rates = getRates(db);
  const scale = new Map<string, number>();
  for (const a of db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(inArray(accounts.id, ids))
    .all()) {
    const rate = a.currency === DISPLAY_CURRENCY ? undefined : rates[a.currency];
    if (rate !== undefined) scale.set(a.id, rate);
  }
  return scale.size ? scale : undefined;
}
