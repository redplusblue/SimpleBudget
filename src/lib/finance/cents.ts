/**
 * Money is stored as integer cents. Decimal strings from SimpleFIN are parsed
 * with string math only; floats never touch the amounts.
 *
 * Rounding policy: inputs with more than two fractional digits are rejected
 * (SimpleFIN never sends them), so no rounding is ever needed.
 */

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?$/;

export class MoneyParseError extends Error {
  constructor(input: string) {
    super(`Invalid money amount: ${JSON.stringify(input)}`);
    this.name = "MoneyParseError";
  }
}

/** `"-1234.56"` → `-123456`. Rejects thousands separators and >2 decimals. */
export function parseCents(input: string): number {
  const trimmed = input.trim();
  const m = DECIMAL_RE.exec(trimmed);
  if (!m) throw new MoneyParseError(input);
  const [, sign, whole = "", frac = ""] = m;
  if (whole === "" && frac === "") throw new MoneyParseError(input);
  if (frac.length > 2) {
    // Trailing zeros beyond 2 places ("12.500") are harmless; anything else is rejected.
    if (!/^\d{2}0*$/.test(frac)) throw new MoneyParseError(input);
  }
  const fracDigits = (frac + "00").slice(0, 2);
  const cents = Number(whole || "0") * 100 + Number(fracDigits);
  if (!Number.isSafeInteger(cents)) throw new MoneyParseError(input);
  return sign === "-" && cents !== 0 ? -cents : cents;
}

/** Plain decimal string for a cents value (`-123456` → `"-1234.56"`). Not locale formatted. */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

export interface FormatCentsOptions {
  currency?: string;
  /** `$12.4k` style. */
  compact?: boolean;
  /** Show a leading + for positive values. */
  signDisplay?: "auto" | "always" | "never";
  /** Drop ".00" when the value is whole dollars. */
  hideZeroCents?: boolean;
  locale?: string;
}

/** The single place money is turned into a display string. */
export function formatCents(cents: number, opts: FormatCentsOptions = {}): string {
  const { currency = "USD", compact = false, signDisplay = "auto", hideZeroCents = false, locale = "en-US" } = opts;
  const units = cents / 100;
  let safeCurrency = currency;
  if (!/^[A-Za-z]{3}$/.test(currency)) safeCurrency = "USD";
  const fmt = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safeCurrency,
    signDisplay: signDisplay === "never" ? "never" : signDisplay === "always" ? "exceptZero" : "auto",
    ...(compact
      ? { notation: "compact" as const, maximumFractionDigits: 1 }
      : hideZeroCents && cents % 100 === 0
        ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
        : {}),
  });
  return fmt.format(units);
}
