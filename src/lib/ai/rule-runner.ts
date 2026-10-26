import "server-only";
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/db/client";
import type { DbLike } from "@/db/open";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getLlmFor, type FeatureLlm } from "@/lib/llm";
import { budgetState, trackRuns } from "@/lib/llm/runs";
import { getNotifyConfig, getNotifyTarget } from "@/lib/notify/config";
import { sendNotification } from "@/lib/notify/send";
import { planSuggestions, suggestRules, type SuggestResult } from "./rule-suggestions";
import { getRuleSuggestSettings, setRuleSuggestLastRun } from "./rule-settings";

const g = globalThis as unknown as { __sbRuleSuggestRunning?: boolean; __sbRuleSuggestCron?: ScheduledTask };

export const isRuleRunRunning = () => g.__sbRuleSuggestRunning === true;

/** Runs `fn` unless another rule-suggestion run is in progress (returns null then). */
export async function runExclusive<T>(fn: () => Promise<T>): Promise<T | null> {
  if (g.__sbRuleSuggestRunning) return null;
  g.__sbRuleSuggestRunning = true;
  try {
    return await fn();
  } finally {
    g.__sbRuleSuggestRunning = false;
  }
}

export type RunReason = "disabled" | "schedule" | "too_few" | "budget" | "busy" | "error" | "ok";

export interface RunnerDeps {
  getLlm?: (db: DbLike) => FeatureLlm | null;
  fetchImpl?: typeof fetch;
}

async function notifyReady(db: DbLike, created: number, fetchImpl?: typeof fetch) {
  try {
    if (created < 1 || !getNotifyConfig(db).enabled) return;
    const target = getNotifyTarget(db);
    if (!target) return;
    await sendNotification(
      target,
      {
        event: "ai_suggestions",
        title: "Rule suggestions ready",
        message: `${created} new rule suggestion${created === 1 ? " is" : "s are"} waiting on the Rules page.`,
      },
      fetchImpl,
    );
  } catch (err) {
    logger.warn({ err }, "rule suggestion alert failed");
  }
}

/** Runs the job if every background condition holds. Never throws (logs instead). Returns why it did or didn't run. */
export async function maybeSuggestRules(
  db: DbLike,
  trigger: "after_sync" | "interval",
  now: number,
  timeZone: string,
  deps: RunnerDeps = {},
): Promise<{ ran: boolean; reason: RunReason; result?: SuggestResult }> {
  try {
    const picked = (deps.getLlm ?? ((d) => getLlmFor(d, "rules")))(db);
    if (!picked) return { ran: false, reason: "disabled" };

    const s = getRuleSuggestSettings(db);
    if (s.schedule !== trigger) return { ran: false, reason: "schedule" };
    if (trigger === "interval" && s.lastRunAt !== null && now - s.lastRunAt < s.intervalDays * 86_400)
      return { ran: false, reason: "schedule" };

    const plan = planSuggestions(db, { maxMerchants: s.maxMerchantsPerRun, entry: picked.entry });
    if (plan.eligible < s.minNewMerchants) return { ran: false, reason: "too_few" };
    if (budgetState(db, now, timeZone).over) return { ran: false, reason: "budget" };

    const out = await runExclusive(async () => {
      const llm = trackRuns(db, picked.llm, {
        feature: "rules",
        model: picked.model,
        trigger,
        subject: `${plan.toSend} merchants`,
        entry: picked.entry,
      });
      const result = await suggestRules(
        { db, llm, model: picked.model, runId: llm.lastRunId, now, timeZone },
        { maxMerchants: s.maxMerchantsPerRun },
      );
      setRuleSuggestLastRun(db, now);
      await notifyReady(db, result.created, deps.fetchImpl);
      return result;
    });
    return out === null ? { ran: false, reason: "busy" } : { ran: true, reason: "ok", result: out };
  } catch (err) {
    logger.warn({ err }, "rule suggestions failed");
    return { ran: false, reason: "error" };
  }
}

/** Daily at 04:15 server time: the "every N days" schedule checks whether it is due. */
export function startRuleSuggestScheduler(): void {
  if (g.__sbRuleSuggestCron) return;
  g.__sbRuleSuggestCron = cron.schedule(
    "15 4 * * *",
    () => {
      void maybeSuggestRules(getDb(), "interval", Math.floor(Date.now() / 1000), getEnv().TZ);
    },
    { timezone: getEnv().TZ, noOverlap: true },
  );
}
