import type { DbLike } from "@/db/open";
import { currentMonth } from "@/lib/finance/dates";
import { createContext } from "./data";
import { GENERATORS } from "./generators";
import { sortInsights, type Insight, type InsightsPayload } from "./types";

/**
 * Every deterministic insight for `month` (default: this month), most important first.
 * A generator that throws is skipped, so one bad query can never take the page down.
 */
export function getInsights(
  db: DbLike,
  opts: { now: number; timeZone: string; month?: string },
  onError: (e: unknown) => void = () => {},
): InsightsPayload {
  const month = opts.month ?? currentMonth(opts.now, opts.timeZone);
  const ctx = createContext(db, opts.now, opts.timeZone, month);
  const insights: Insight[] = [];
  for (const generate of GENERATORS) {
    try {
      insights.push(...generate(ctx));
    } catch (e) {
      onError(e);
    }
  }
  return { month, generatedAt: opts.now, insights: sortInsights(insights) };
}
