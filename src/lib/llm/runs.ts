import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiRuns, type AiTrigger } from "@/db/schema";
import { currentMonth, monthRange } from "@/lib/finance/dates";
import { getAiConfig } from "./config";
import type { AiFeature, ModelEntry } from "./models";
import { LlmError, type GenerateRequest, type LlmClient, type LlmUsage } from "./types";

const unixNow = () => Math.floor(Date.now() / 1000);

export interface RunMeta {
  feature: AiFeature;
  model: string;
  trigger: AiTrigger;
  subject?: string;
  entry?: ModelEntry;
}

/** Wraps a client so every generate() call writes one ai_runs row (usage summed over all rounds). */
export function trackRuns(
  db: DbLike,
  client: LlmClient,
  meta: RunMeta,
  now: () => number = unixNow,
): LlmClient & { lastRunId(): number | null } {
  let last: number | null = null;
  return {
    lastRunId: () => last,
    async generate(req: GenerateRequest) {
      const row = db
        .insert(aiRuns)
        .values({
          feature: meta.feature,
          model: meta.model,
          trigger: meta.trigger,
          status: "running",
          subject: meta.subject ?? null,
          startedAt: now(),
        })
        .returning({ id: aiRuns.id })
        .get();
      last = row.id;
      let prompt = 0;
      let completion = 0;
      let cached = 0;
      let cost = 0;
      let rounds = 0;
      let costRounds = 0;
      const onUsage = (u: LlmUsage) => {
        rounds++;
        prompt += u.promptTokens;
        completion += u.completionTokens;
        cached += u.cachedTokens;
        if (u.costMicros !== null) {
          costRounds++;
          cost += u.costMicros;
        }
        req.onUsage?.(u);
      };
      const finish = (status: "ok" | "error", errorKind: string | null) => {
        let costMicros: number | null = null;
        let estimated = false;
        const { inputPerMTok, outputPerMTok } = meta.entry ?? {};
        if (rounds > 0 && costRounds === rounds) costMicros = cost;
        else if (inputPerMTok !== undefined && outputPerMTok !== undefined && rounds > 0) {
          // USD per million tokens x tokens = micro-USD.
          costMicros = Math.round(prompt * inputPerMTok + completion * outputPerMTok);
          estimated = true;
        }
        db.update(aiRuns)
          .set({
            status,
            errorKind,
            promptTokens: prompt,
            completionTokens: completion,
            cachedTokens: cached,
            costMicros,
            costEstimated: estimated,
            finishedAt: now(),
          })
          .where(eq(aiRuns.id, row.id))
          .run();
      };
      try {
        const out = await client.generate({ ...req, onUsage });
        finish("ok", null);
        return out;
      } catch (e) {
        finish("error", e instanceof LlmError ? e.kind : "unavailable");
        throw e;
      }
    },
  };
}

function monthBounds(now: number, timeZone: string) {
  return monthRange(currentMonth(now, timeZone), timeZone);
}

/** Spend this calendar month (server TZ) in micro-USD, counting only rows with a cost. */
export function monthSpendMicros(db: DbLike, now: number, timeZone: string): number {
  const { start, end } = monthBounds(now, timeZone);
  const row = db
    .select({ total: sql<number>`coalesce(sum(${aiRuns.costMicros}), 0)` })
    .from(aiRuns)
    .where(and(gte(aiRuns.startedAt, start), lt(aiRuns.startedAt, end)))
    .get();
  return row?.total ?? 0;
}

export interface BudgetState {
  spentMicros: number;
  budgetMicros: number | null;
  over: boolean;
}

export function budgetState(db: DbLike, now: number, timeZone: string): BudgetState {
  const budgetMicros = getAiConfig(db).monthlyBudgetMicros;
  const spentMicros = monthSpendMicros(db, now, timeZone);
  return { spentMicros, budgetMicros, over: budgetMicros !== null && spentMicros >= budgetMicros };
}

export const formatMicros = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** Throws LlmError(kind "declined") with a readable message when the month's budget is used up. */
export function assertWithinBudget(db: DbLike, now: number, timeZone: string): void {
  const s = budgetState(db, now, timeZone);
  if (!s.over || s.budgetMicros === null) return;
  throw new LlmError(
    `This month's AI budget is used up (${formatMicros(s.spentMicros)} of ${formatMicros(s.budgetMicros)}). Raise it in Settings → AI.`,
    "declined",
  );
}

export interface UsageRunRow {
  id: number;
  feature: string;
  model: string;
  trigger: string;
  status: string;
  subject: string | null;
  promptTokens: number;
  completionTokens: number;
  costMicros: number | null;
  costEstimated: boolean;
  startedAt: number;
}

export interface UsageReport extends BudgetState {
  byFeature: { feature: string; runs: number; costMicros: number; tokens: number }[];
  recent: UsageRunRow[];
}

/** For the settings page: totals per feature this month and the last `limit` runs. */
export function usageReport(db: DbLike, now: number, timeZone: string, limit = 20): UsageReport {
  const { start, end } = monthBounds(now, timeZone);
  const byFeature = db
    .select({
      feature: aiRuns.feature,
      runs: sql<number>`count(*)`,
      costMicros: sql<number>`coalesce(sum(${aiRuns.costMicros}), 0)`,
      tokens: sql<number>`coalesce(sum(${aiRuns.promptTokens} + ${aiRuns.completionTokens}), 0)`,
    })
    .from(aiRuns)
    .where(and(gte(aiRuns.startedAt, start), lt(aiRuns.startedAt, end)))
    .groupBy(aiRuns.feature)
    .all();
  const recent = db
    .select({
      id: aiRuns.id,
      feature: aiRuns.feature,
      model: aiRuns.model,
      trigger: aiRuns.trigger,
      status: aiRuns.status,
      subject: aiRuns.subject,
      promptTokens: aiRuns.promptTokens,
      completionTokens: aiRuns.completionTokens,
      costMicros: aiRuns.costMicros,
      costEstimated: aiRuns.costEstimated,
      startedAt: aiRuns.startedAt,
    })
    .from(aiRuns)
    .orderBy(desc(aiRuns.startedAt), desc(aiRuns.id))
    .limit(limit)
    .all();
  return { ...budgetState(db, now, timeZone), byFeature, recent };
}
