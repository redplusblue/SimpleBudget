export const DAY = 86_400;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Intl formatters are slow to construct, so they're cached per locale/zone/options. */
function formatter(locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(opts)}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat(locale, { timeZone, ...opts });
    } catch {
      fmt = new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }); // unknown zone: fall back to UTC
    }
    formatters.set(key, fmt);
  }
  return fmt;
}

const DATE_PARTS = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

/** `YYYY-MM-DD` for a unix timestamp in the given IANA timezone. */
export function localDateString(unixSeconds: number, timeZone: string): string {
  return formatter("en-CA", timeZone, DATE_PARTS).format(new Date(unixSeconds * 1000));
}

export const utcDateString = (unixSeconds: number) => localDateString(unixSeconds, "UTC");

/** Seconds the zone is ahead of UTC at the given instant (negative west of Greenwich). */
export function tzOffsetSeconds(unixSeconds: number, timeZone: string): number {
  const parts = formatter("en-US", timeZone, {
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) / 1000;
  return asUtc - Math.floor(unixSeconds);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Calendar arithmetic on `YYYY-MM-DD` strings (timezone independent). */
export function addDaysToDate(date: string, days: number): string {
  const m = DATE_RE.exec(date)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days)).toISOString().slice(0, 10);
}

/** Unix timestamp of local midnight at the start of `date` in the given timezone. */
export function zonedDayStart(date: string, timeZone: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
  let t = guess;
  // Two passes settle the offset even when it changes (DST) between the guess and the answer.
  for (let i = 0; i < 2; i++) t = guess - tzOffsetSeconds(t, timeZone);
  return t;
}

/** `[start, end)` unix range covering a local `YYYY-MM` month. */
export function monthRange(month: string, timeZone: string): { start: number; end: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Invalid month: ${month}`);
  const next = +m[2] === 12 ? `${+m[1] + 1}-01` : `${m[1]}-${String(+m[2] + 1).padStart(2, "0")}`;
  return { start: zonedDayStart(`${month}-01`, timeZone), end: zonedDayStart(`${next}-01`, timeZone) };
}

export function currentMonth(unixSeconds: number, timeZone: string): string {
  return localDateString(unixSeconds, timeZone).slice(0, 7);
}

/** Number of days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  return new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
}

/** The `YYYY-MM` that is `delta` months from `month` (negative = earlier). */
export function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
