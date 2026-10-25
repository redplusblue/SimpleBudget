import { and, desc, eq } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { insightsCache, syncRuns } from "@/db/schema";
import { currentMonth } from "@/lib/finance/dates";
import { buildAiContext } from "./context";
import { LLM_TOOLS, createToolRunner } from "./tools";
import type { ChatTurn, LlmClient } from "./types";

export const SUMMARY_KIND = "summary";

const BASE_SYSTEM = `You are a personal-finance assistant inside a self-hosted budgeting app. You only know what is in the data you are given or what the tools return.
- Use the exact figures provided; never invent or estimate numbers that are not there.
- Amounts are US dollars. Spending is money going out; income is money coming in.
- Be concise and plain-spoken. No lectures, no generic advice, no disclaimers about not being a financial advisor.`;

const SUMMARY_INSTRUCTIONS = `Write a monthly summary of the data above as markdown:
- 5 to 8 short bullet points covering the most important things that happened (biggest categories, changes from last month and the 3-month average, notable merchants, anything in the insights list).
- Then a "Suggestions" heading with 2 to 3 specific, practical suggestions based on this data.
Keep the whole thing under 250 words.`;

export interface CachedSummary {
  text: string;
  model: string;
  createdAt: number;
}

/** A saved summary for `month`, unless a sync has finished since it was written (new data makes it stale). */
export function getCachedSummary(db: DbLike, month: string): CachedSummary | null {
  const row = db
    .select()
    .from(insightsCache)
    .where(and(eq(insightsCache.month, month), eq(insightsCache.kind, SUMMARY_KIND)))
    .orderBy(desc(insightsCache.createdAt), desc(insightsCache.id))
    .get();
  if (!row) return null;
  const lastSync = db
    .select({ at: syncRuns.finishedAt })
    .from(syncRuns)
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1)
    .get()?.at;
  if (lastSync && lastSync > row.createdAt) return null;
  try {
    const parsed = JSON.parse(row.payloadJson) as { text?: unknown; model?: unknown };
    return typeof parsed.text === "string"
      ? { text: parsed.text, model: String(parsed.model ?? ""), createdAt: row.createdAt }
      : null;
  } catch {
    return null;
  }
}

function saveSummary(db: DbLike, month: string, text: string, model: string, now: number) {
  db.transaction((tx) => {
    tx.delete(insightsCache)
      .where(and(eq(insightsCache.month, month), eq(insightsCache.kind, SUMMARY_KIND)))
      .run();
    tx.insert(insightsCache)
      .values({ month, kind: SUMMARY_KIND, payloadJson: JSON.stringify({ text, model }), createdAt: now })
      .run();
  });
}

export interface NarrativeEnv {
  db: DbLike;
  llm: LlmClient;
  model: string;
  includeBalances: boolean;
  now: number;
  timeZone: string;
}

/** Generates (and caches) the monthly narrative, streaming pieces through `onText`. */
export async function generateSummary(env: NarrativeEnv, onText?: (delta: string) => void): Promise<CachedSummary> {
  const month = currentMonth(env.now, env.timeZone);
  const context = buildAiContext(env.db, {
    now: env.now,
    timeZone: env.timeZone,
    month,
    includeBalances: env.includeBalances,
  });
  const text = await env.llm.generate({
    system: BASE_SYSTEM,
    user: `Here is my spending data for ${month} (aggregated; amounts in USD):\n\n${JSON.stringify(context, null, 2)}\n\n${SUMMARY_INSTRUCTIONS}`,
    onText,
    maxTokens: 1200,
  });
  saveSummary(env.db, month, text, env.model, env.now);
  return { text, model: env.model, createdAt: env.now };
}

export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 10;

/** Answers a free-form question from the aggregates plus two read-only lookup tools. */
export async function answerQuestion(env: NarrativeEnv, question: string, history: ChatTurn[] = []): Promise<string> {
  const month = currentMonth(env.now, env.timeZone);
  const context = buildAiContext(env.db, {
    now: env.now,
    timeZone: env.timeZone,
    month,
    includeBalances: env.includeBalances,
  });
  return env.llm.generate({
    system: `${BASE_SYSTEM}\nYou can call get_category_totals for any month and search_transactions to look up individual purchases; use them when the summary below does not answer the question. Today is in ${month}.\n\nSummary of this month:\n${JSON.stringify(context, null, 2)}`,
    history: history.slice(-MAX_HISTORY_TURNS),
    user: question.slice(0, MAX_QUESTION_CHARS),
    tools: LLM_TOOLS,
    runTool: createToolRunner(env.db, env.now, env.timeZone),
    maxTokens: 1500,
  });
}
