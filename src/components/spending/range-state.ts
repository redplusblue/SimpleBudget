import { addDays, endOfMonth, format, startOfMonth, startOfYear, subMonths } from "date-fns";
import { isDateString } from "@/lib/finance/dates";

export type RangeState = { kind: "month"; month: string } | { kind: "custom"; from: string; to: string };

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const ym = (d: Date) => format(d, "yyyy-MM");
export const currentMonthLocal = (now = new Date()) => ym(now);

/** Custom-range shortcuts, computed from the browser's current date. */
export function customPresets(now = new Date()): Array<{ label: string; from: string; to: string }> {
  const lastMonth = subMonths(now, 1);
  return [
    { label: "Last 30 days", from: ymd(addDays(now, -29)), to: ymd(now) },
    { label: "Last 90 days", from: ymd(addDays(now, -89)), to: ymd(now) },
    { label: "Last month", from: ymd(startOfMonth(lastMonth)), to: ymd(endOfMonth(lastMonth)) },
    { label: "Year to date", from: ymd(startOfYear(now)), to: ymd(now) },
    { label: "Last 12 months", from: ymd(addDays(now, -364)), to: ymd(now) },
  ];
}

/** `?month=2026-10` or `?from=…&to=…`; anything invalid falls back to `fallbackMonth`. */
export function parseRange(params: URLSearchParams, fallbackMonth: string): RangeState {
  const from = params.get("from");
  const to = params.get("to");
  if (from && to && isDateString(from) && isDateString(to) && from <= to) return { kind: "custom", from, to };
  const month = params.get("month");
  return { kind: "month", month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : fallbackMonth };
}

export function rangeQuery(range: RangeState): string {
  return range.kind === "month" ? `month=${range.month}` : `from=${range.from}&to=${range.to}`;
}
