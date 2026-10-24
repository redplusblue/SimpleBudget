import { addDays, endOfMonth, format, startOfMonth, startOfYear, subMonths } from "date-fns";

export type DatePreset = "all" | "this-month" | "last-month" | "30d" | "90d" | "ytd" | "custom";

export const DATE_PRESET_LABELS: Record<Exclude<DatePreset, "custom">, string> = {
  all: "All time",
  "this-month": "This month",
  "last-month": "Last month",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
};

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** `from`/`to` (inclusive local dates) for a preset. Open-ended presets leave `to` unset. */
export function presetRange(
  preset: Exclude<DatePreset, "custom">,
  now: Date = new Date(),
): { from?: string; to?: string } {
  switch (preset) {
    case "all":
      return {};
    case "this-month":
      return { from: ymd(startOfMonth(now)) };
    case "last-month": {
      const prev = subMonths(now, 1);
      return { from: ymd(startOfMonth(prev)), to: ymd(endOfMonth(prev)) };
    }
    case "30d":
      return { from: ymd(addDays(now, -29)) };
    case "90d":
      return { from: ymd(addDays(now, -89)) };
    case "ytd":
      return { from: ymd(startOfYear(now)) };
  }
}

/** Which preset (if any) the current range corresponds to; anything else is "custom". */
export function detectPreset(from: string | undefined, to: string | undefined, now: Date = new Date()): DatePreset {
  for (const key of Object.keys(DATE_PRESET_LABELS) as Array<Exclude<DatePreset, "custom">>) {
    const r = presetRange(key, now);
    if (r.from === from && r.to === to) return key;
  }
  return "custom";
}
