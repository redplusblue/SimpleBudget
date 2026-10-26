import { z } from "zod";
import type { DbLike } from "@/db/open";
import { categories } from "@/db/schema";
import { formatCents } from "@/lib/finance/cents";
import { isDateString, localDateString } from "@/lib/finance/dates";
import { normalizePayee } from "@/lib/finance/payee";
import { getSpendingReport } from "@/lib/finance/spending-report";
import { queryTransactions } from "@/lib/finance/transactions-query";
import { collectFacts, factsForLens, factsForModel } from "@/lib/ai/facts";
import { LENS_IDS } from "@/lib/ai/lenses";
import { findMerchantGroup } from "@/lib/ai/merchant-lookup";
import { traceForModel } from "@/lib/ai/trace-model";
import { traceTransaction } from "@/lib/finance/trace";
import { listGoalProgress } from "@/lib/finance/goals";
import { merchantHistory, monthlyTrend, periodReport, recurringSummary, yearSummary } from "./analysis";
import type { LlmTool } from "./types";

export const MAX_SEARCH_ROWS = 50;

export const LLM_TOOLS: LlmTool[] = [
  {
    name: "get_category_totals",
    description: "Spending per category for one calendar month, with the previous month for comparison.",
    inputSchema: {
      type: "object",
      properties: { month: { type: "string", description: "Month as YYYY-MM, e.g. 2026-09" } },
      required: ["month"],
    },
  },
  {
    name: "search_transactions",
    description: `Search purchases and deposits by text in the payee. Returns at most ${MAX_SEARCH_ROWS} rows (date, payee, amount, category), newest first.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for in the payee, e.g. 'coffee'" },
        from: { type: "string", description: "Earliest date, YYYY-MM-DD (optional)" },
        to: { type: "string", description: "Latest date, YYYY-MM-DD (optional)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_period_report",
    description:
      "Full report for a month or a custom date range (up to a year): spent, income, savings rate, categories compared with the previous period, top merchants, largest purchase, spending by weekday.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month as YYYY-MM. Use this or from+to." },
        from: { type: "string", description: "Earliest date, YYYY-MM-DD" },
        to: { type: "string", description: "Latest date, YYYY-MM-DD" },
      },
    },
  },
  {
    name: "get_monthly_trend",
    description:
      "Spending, income and net for each of the 12 months ending at the given month, plus the biggest categories month by month. Use for trends, seasonality and 'is it getting better' questions.",
    inputSchema: {
      type: "object",
      properties: { end_month: { type: "string", description: "Last month of the window, YYYY-MM" } },
      required: ["end_month"],
    },
  },
  {
    name: "get_recurring",
    description:
      "Detected subscriptions and regular bills: amount, cadence, next charge, monthly and yearly cost, price increases, and ones that look cancelled.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_year_summary",
    description:
      "One calendar year in review: totals, savings rate, by month, top categories and merchants, biggest risers and fallers versus the year before.",
    inputSchema: {
      type: "object",
      properties: { year: { type: "integer", description: "Calendar year, e.g. 2026" } },
      required: ["year"],
    },
  },
  {
    name: "get_merchant_history",
    description:
      "How much a merchant or kind of purchase has cost month by month (text match on the payee, e.g. 'uber', 'netflix').",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Text to look for in the payee" } },
      required: ["query"],
    },
  },
  {
    name: "get_facts",
    description:
      "Computed observations about the owner's money that are worth talking about (warnings first): changes, bills due, targets, goals, accounts needing attention, data cleanup. Optionally only those for one area.",
    inputSchema: {
      type: "object",
      properties: { lens: { type: "string", enum: [...LENS_IDS], description: "Limit to one area (optional)" } },
    },
  },
  {
    name: "get_merchant_trace",
    description:
      "Everything known about one merchant across all time, from the most recent matching transaction: totals, typical charge, cadence, price changes, refunds, duplicates, similar merchant names and how it is categorized.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Text to look for in the payee, e.g. 'netflix'" } },
      required: ["query"],
    },
  },
  {
    name: "get_goals",
    description: "Savings goals: name, target, progress, target date and whether the current pace will reach it.",
    inputSchema: { type: "object", properties: {} },
  },
];

/** The tools the original Ask box offers; the Assistant and the MCP server also get the newer ones. */
const NEWER_TOOLS = new Set(["get_facts", "get_goals", "get_merchant_trace"]);
export const ASK_TOOLS = LLM_TOOLS.filter((t) => !NEWER_TOOLS.has(t.name));

const monthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-09") });
const periodInput = z.union([
  monthInput,
  z.object({
    from: z.string().refine(isDateString, "from must be YYYY-MM-DD"),
    to: z.string().refine(isDateString, "to must be YYYY-MM-DD"),
  }),
]);
const trendInput = z.object({ end_month: monthInput.shape.month });
const yearInput = z.object({ year: z.number().int().min(1970).max(2200) });
const factsInput = z.object({ lens: z.enum(LENS_IDS).optional() });
const queryInput = z.object({ query: z.string().trim().min(1).max(100) });
const searchInput = z.object({
  query: z.string().trim().min(1).max(100),
  from: z.string().refine(isDateString, "from must be YYYY-MM-DD").optional(),
  to: z.string().refine(isDateString, "to must be YYYY-MM-DD").optional(),
});

/** Executes one of the read-only tools. Output contains no account ids, notes, memos or raw descriptions. */
export function createToolRunner(db: DbLike, now: number, timeZone: string, includeBalances = false) {
  return (name: string, input: unknown): string => {
    if (name === "get_category_totals") {
      const { month } = monthInput.parse(input);
      const report = getSpendingReport(db, { month }, now, timeZone);
      return JSON.stringify({
        month,
        totalSpent: formatCents(report.summary.spentCents),
        categories: report.comparison.map((c) => ({
          name: c.name,
          spent: formatCents(c.cents),
          previousMonth: formatCents(c.previousCents),
        })),
      });
    }
    if (name === "search_transactions") {
      const { query, from, to } = searchInput.parse(input);
      const page = queryTransactions(
        db,
        { q: query, from, to },
        { limit: MAX_SEARCH_ROWS, timeZone, includeTotal: true },
      );
      const names = new Map(
        db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .all()
          .map((c) => [c.id, c.name]),
      );
      return JSON.stringify({
        matches: page.total ?? page.rows.length,
        shown: page.rows.length,
        transactions: page.rows.slice(0, MAX_SEARCH_ROWS).map((r) => ({
          date: localDateString(r.effectiveDate, timeZone),
          payee: normalizePayee(r.displayPayee) || "Unknown",
          amount: formatCents(r.amountCents),
          category: r.categoryId === null ? "Uncategorized" : (names.get(r.categoryId) ?? "Uncategorized"),
        })),
      });
    }
    const env = { now, timeZone };
    if (name === "get_period_report") return JSON.stringify(periodReport(db, periodInput.parse(input), env));
    if (name === "get_monthly_trend") return JSON.stringify(monthlyTrend(db, trendInput.parse(input).end_month, env));
    if (name === "get_recurring") return JSON.stringify(recurringSummary(db, env));
    if (name === "get_year_summary") return JSON.stringify(yearSummary(db, yearInput.parse(input).year, env));
    if (name === "get_merchant_history") return JSON.stringify(merchantHistory(db, queryInput.parse(input).query, env));
    if (name === "get_facts") {
      const { lens } = factsInput.parse(input ?? {});
      const facts = factsForLens(collectFacts(db, { now, timeZone, includeBalances }), lens ?? "all");
      return JSON.stringify({ facts: factsForModel(facts, includeBalances) });
    }
    if (name === "get_merchant_trace") {
      const { query } = queryInput.parse(input);
      const group = findMerchantGroup(db, query, timeZone);
      if (!group) return JSON.stringify({ error: `No transactions match "${query}".` });
      const trace = traceTransaction(db, group.latestId, now, timeZone);
      return JSON.stringify(trace ? traceForModel(trace) : { error: "No history found." });
    }
    if (name === "get_goals") {
      return JSON.stringify({
        goals: listGoalProgress(db, now, timeZone).map((g) => ({
          name: g.name,
          target: formatCents(g.targetCents),
          progress: `${Math.round(g.fraction * 100)}%`,
          targetDate: g.targetDate,
          status: g.status,
          onPace: g.status === "done" || g.status === "on_track",
          neededPerMonth: g.neededPerMonthCents === null ? null : formatCents(g.neededPerMonthCents),
          // Balances are opt-in.
          ...(includeBalances ? { saved: formatCents(g.savedCents), remaining: formatCents(g.remainingCents) } : {}),
        })),
      });
    }
    throw new Error(`Unknown tool: ${name}`);
  };
}
