/**
 * Bank descriptions are noisy: processor prefixes ("SQ *"), store numbers, cities, card digits. These helpers
 * reduce them to a merchant name for grouping and rule matching. Stored data is never changed.
 */

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(
    " ",
  ),
);

/** State codes that are also common words; a lone trailing "IN"/"OR"/"ME" is more likely a word than a location. */
const AMBIGUOUS_STATES = new Set(["IN", "OR", "ME", "OK", "HI", "ID", "LA", "DE", "AL", "PA"]);

/** Words that start multi-word city names ("SAN FRANCISCO", "NEW YORK", "FORT WORTH"). */
const CITY_PREFIXES = new Set(
  "SAN SANTA LOS LAS NEW FORT ST SAINT MOUNT MT SALT EL PORT WEST EAST NORTH SOUTH LAKE GRAND PALM VAL BATON LA".split(
    " ",
  ),
);

/** Payment processors and channel markers that carry no merchant information. */
const LEADING_NOISE: RegExp[] = [
  /^(?:sq|tst|pp|paypal|google|gglpay|cko|sp)\s?\*\s*/i, // "SQ *", "TST*", "PAYPAL *", "GOOGLE *"
  /^(?:pos(?:\s+(?:debit|purchase))?|debit\s+card\s+purchase|debit\s+purchase|check\s?card|check\s+crd|dda\s+purchase|ach\s+debit|recurring\s+(?:payment|purchase)|purchase\s+authorized\s+on\s+\d{1,2}\/\d{1,2})\s+/i,
];

const PHONE = /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const CARD_SUFFIX = /\b(?:card|crd|ending|x{2,}|\*{2,})\s*#?x*\d{4}\b/gi;
const MASKED_CARD = /\bx{2,}\d{2,}\b/gi;
const SHORT_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const STORE_NUMBER = /(?:#|\bno\.?\s|\bstore\s*#?|\bunit\s*#?|\bloc\s*#?)\s*\d+\b/gi;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function stripLocation(tokens: string[]): string[] {
  if (tokens.length < 2) return tokens;
  const last = tokens[tokens.length - 1];
  if (!US_STATES.has(last) || last !== last.toUpperCase()) return tokens;
  // "HULU CA": a state with no city in front of it. Only strip it when it can't be an ordinary word.
  if (tokens.length === 2 && AMBIGUOUS_STATES.has(last)) return tokens;
  const out = tokens.slice(0, -1);
  const city = out[out.length - 1];
  // Only drop a plain-word city; keep things like "AMZN.COM/BILL".
  if (!/^[A-Za-z'-]+$/.test(city) || out.length < 2) return out;
  out.pop();
  const before = out[out.length - 1];
  if (before && out.length >= 2 && CITY_PREFIXES.has(before.toUpperCase().replace(/\.$/, ""))) out.pop();
  return out;
}

/**
 * Best-effort merchant name: processor prefixes, phone numbers, dates, masked card digits, store numbers and a
 * trailing "CITY ST" are removed and whitespace collapsed. Case is preserved. Returns the trimmed input if
 * cleaning would leave nothing.
 */
export function normalizePayee(raw: string): string {
  const original = collapse(raw);
  if (!original) return "";
  let s = original;

  for (let i = 0; i < 2; i++) for (const re of LEADING_NOISE) s = s.replace(re, "");
  s = s
    .replace(PHONE, " ")
    .replace(CARD_SUFFIX, " ")
    .replace(MASKED_CARD, " ")
    .replace(SHORT_DATE, " ")
    .replace(STORE_NUMBER, " ");

  let tokens = collapse(s).split(" ").filter(Boolean);
  // A leading bare 4-digit token is a posting date (MMDD) left behind by "CHECKCARD 0412 ..."
  if (tokens.length > 1 && /^\d{4}$/.test(tokens[0])) tokens.shift();
  // Trailing store/terminal numbers: any run of 3+ digit-only tokens at the end ("TARGET 00012345", "SHELL OIL 57444").
  while (tokens.length > 1 && /^\d{3,}$/.test(tokens[tokens.length - 1])) tokens.pop();
  tokens = stripLocation(tokens);
  while (tokens.length > 1 && /^\d{3,}$/.test(tokens[tokens.length - 1])) tokens.pop();

  const cleaned = collapse(
    tokens
      .join(" ")
      .replace(/\*/g, " ")
      .replace(/^[\s\-–,.:;]+|[\s\-–,.:;]+$/g, ""),
  );
  return cleaned || original;
}

/** Case- and punctuation-insensitive grouping key ("Trader Joe's" and "TRADER JOES" match). */
export function payeeKey(raw: string): string {
  return normalizePayee(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** The grouping key stored in `transactions.merchant_key`; never empty so every row groups somewhere. */
export const merchantKey = (raw: string): string => payeeKey(raw) || "unknown";
