import { z } from "zod";
import type { DbLike } from "@/db/open";
import { categories } from "@/db/schema";
import { formatCents } from "@/lib/finance/cents";
import { isDateString, localDateString } from "@/lib/finance/dates";
import { normalizePayee } from "@/lib/finance/payee";
import { getSpendingReport } from "@/lib/finance/spending-report";
import { queryTransactions } from "@/lib/finance/transactions-query";
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
];

const monthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-09") });
const searchInput = z.object({
  query: z.string().trim().min(1).max(100),
  from: z.string().refine(isDateString, "from must be YYYY-MM-DD").optional(),
  to: z.string().refine(isDateString, "to must be YYYY-MM-DD").optional(),
});

/** Executes one of the read-only tools. Output contains no account ids, notes, memos or raw descriptions. */
export function createToolRunner(db: DbLike, now: number, timeZone: string) {
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
    throw new Error(`Unknown tool: ${name}`);
  };
}
