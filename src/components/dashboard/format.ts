import { daysInMonth } from "@/lib/finance/dates";

/** Query string that opens the register on a month's spending (or income) with optional extra filters. */
export function monthLink(month: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
    ...extra,
  });
  return `/transactions?${params}`;
}

export const percent = (ratio: number, digits = 1) => `${(Math.abs(ratio) * 100).toFixed(digits)}%`;
