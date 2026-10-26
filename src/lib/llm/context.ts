import { accounts } from "@/db/schema";
import type { DbLike } from "@/db/open";
import { formatCents } from "@/lib/finance/cents";
import { getSpendingReport } from "@/lib/finance/spending-report";
import { getInsights } from "@/lib/insights";

// Everything the model is allowed to see is assembled here, from aggregates only. Nothing in this file reads
// account ids, access URLs, raw descriptions, notes or memos, and the insights are filtered by an allow-list.

const $ = (cents: number) => formatCents(cents);

/** Insights that talk about spending patterns. Balance-related ones (`low-balance:`, `utilization:`, `stale-manual:`) are opt-in. */
const SPENDING_INSIGHTS = [
  "category-up:",
  "category-down:",
  "new-merchant:",
  "price-increase:",
  "new-recurring:",
  "large-txn:",
  "pace:",
  "income-changed:",
  "income-arrived:",
  "duplicate:",
  "uncategorized",
];
const BALANCE_INSIGHTS = ["low-balance:", "utilization:", "stale-manual:"];

export interface AiContext {
  month: string;
  /** Spending, income and the previous month, as formatted dollar strings. */
  totals: { spent: string; income: string; previousMonthSpent: string; dayOfMonth: number; daysInMonth: number };
  categories: Array<{ name: string; spent: string; lastMonth: string; threeMonthAverage: string | null }>;
  topMerchants: Array<{ name: string; total: string; purchases: number }>;
  insights: Array<{ severity: string; title: string; detail: string }>;
  /** Only present when the user ticked "include account names and balances". */
  accounts?: Array<{ name: string; type: string; balance: string }>;
}

export function buildAiContext(
  db: DbLike,
  opts: { now: number; timeZone: string; month: string; includeBalances: boolean },
): AiContext {
  const report = getSpendingReport(db, { month: opts.month }, opts.now, opts.timeZone);
  const allowed = opts.includeBalances ? [...SPENDING_INSIGHTS, ...BALANCE_INSIGHTS] : SPENDING_INSIGHTS;
  const insights = getInsights(db, { now: opts.now, timeZone: opts.timeZone, month: opts.month }).insights.filter((i) =>
    allowed.some((prefix) => i.id.startsWith(prefix)),
  );
  const context: AiContext = {
    month: opts.month,
    totals: {
      spent: $(report.summary.spentCents),
      income: $(report.summary.incomeCents),
      previousMonthSpent: $(report.summary.previousSpentCents),
      dayOfMonth: report.range.elapsedDays,
      daysInMonth: report.range.days,
    },
    categories: report.comparison.slice(0, 15).map((c) => ({
      name: c.name,
      spent: $(c.cents),
      lastMonth: $(c.previousCents),
      threeMonthAverage: c.averageCents === null ? null : $(c.averageCents),
    })),
    topMerchants: report.merchants.slice(0, 10).map((m) => ({ name: m.name, total: $(m.cents), purchases: m.count })),
    insights: insights.map((i) => ({ severity: i.severity, title: i.title, detail: i.body })),
  };
  if (opts.includeBalances) {
    context.accounts = db
      .select()
      .from(accounts)
      .all()
      .filter((a) => !a.isHidden && !a.isClosed)
      .map((a) => ({ name: a.displayName || a.name, type: a.type, balance: $(a.balanceCents) }));
  }
  return context;
}
