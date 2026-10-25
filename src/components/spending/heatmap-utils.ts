import type { DailySpend } from "@/lib/finance/spending-report-types";

const LEVELS = 4;

/**
 * The spend that counts as "busiest": the 90th percentile of days with spending, so one huge day (rent) doesn't
 * wash every other day out to the palest shade.
 */
export function heatScale(days: DailySpend[]): number {
  const spent = days
    .map((d) => d.cents)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  if (spent.length === 0) return 0;
  return spent[Math.min(spent.length - 1, Math.floor(spent.length * 0.9))];
}

/** 0 = nothing spent, 1..4 = quartile-ish intensity relative to the busiest day. */
export function intensity(cents: number, max: number): number {
  if (cents <= 0 || max <= 0) return 0;
  return Math.min(LEVELS, Math.max(1, Math.ceil((cents / max) * LEVELS)));
}

/** Weeks as rows, Sunday first, padded so the first day lands in the right column. */
export function calendarWeeks(days: DailySpend[]): Array<Array<DailySpend | null>> {
  if (days.length === 0) return [];
  const lead = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const cells: Array<DailySpend | null> = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
