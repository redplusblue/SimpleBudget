import type { DailySpend } from "@/lib/finance/spending-report-types";

const LEVELS = 4;

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
