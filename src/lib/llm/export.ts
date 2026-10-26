import type { DbLike } from "@/db/open";
import { currentMonth, localDateString } from "@/lib/finance/dates";
import { monthlyTrend, periodReport, recurringSummary, yearSummary } from "./analysis";
import { buildAiContext } from "./context";

/**
 * A single markdown document with the same aggregates the in-app assistant gets, plus the 12-month trend, last
 * year's review and the subscriptions list. Paste it into any chat assistant (or attach it) and ask questions.
 */
export function buildExport(
  db: DbLike,
  opts: { now: number; timeZone: string; month?: string; includeBalances: boolean },
): string {
  const env = { now: opts.now, timeZone: opts.timeZone };
  const month = opts.month ?? currentMonth(opts.now, opts.timeZone);
  const year = Number(localDateString(opts.now, opts.timeZone).slice(0, 4));
  const json = (v: unknown) => `\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;
  return [
    `# SimpleBudget snapshot (${month})`,
    `Generated ${localDateString(opts.now, opts.timeZone)}. Amounts are formatted dollars; negative means money out. Aggregates only: no account numbers, notes or bank descriptions.`,
    `You are my personal-finance analyst. Use only these numbers, never invent any, and say when something is not in the data. Start by telling me the 3 most important things, then answer my questions.`,
    `## This month so far\n${json(buildAiContext(db, { ...env, month, includeBalances: opts.includeBalances }))}`,
    `## Full report for ${month}\n${json(periodReport(db, { month }, env))}`,
    `## Twelve months ending ${month}\n${json(monthlyTrend(db, month, env))}`,
    `## Subscriptions and regular bills\n${json(recurringSummary(db, env))}`,
    `## ${year} so far\n${json(yearSummary(db, year, env))}`,
    ...(year > 1970 ? [`## ${year - 1}\n${json(yearSummary(db, year - 1, env))}`] : []),
  ].join("\n\n");
}
