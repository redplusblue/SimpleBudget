export const DAY = 86_400;

/** `YYYY-MM-DD` for a unix timestamp in the given IANA timezone. */
export function localDateString(unixSeconds: number, timeZone: string): string {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return fmt.format(new Date(unixSeconds * 1000));
}

export const utcDateString = (unixSeconds: number) => localDateString(unixSeconds, "UTC");
