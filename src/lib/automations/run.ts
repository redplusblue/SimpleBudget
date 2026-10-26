import "server-only";
import { and, desc, eq, notInArray } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiThreads, automationRuns, automations } from "@/db/schema";
import { chat } from "@/lib/ai/assistant";
import { collectFacts, factsForLens, factsForModel } from "@/lib/ai/facts";
import { generateInsightCards } from "@/lib/ai/insight-cards";
import { formatCents } from "@/lib/finance/cents";
import { currentMonth } from "@/lib/finance/dates";
import { getSpendingReport } from "@/lib/finance/spending-report";
import { logger } from "@/lib/logger";
import { getLlmFor, type FeatureLlm } from "@/lib/llm";
import { getAiConfig } from "@/lib/llm/config";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";
import { LlmError } from "@/lib/llm/types";
import type { Notification } from "@/lib/notify/send";
import { sendTo } from "./destinations";
import { isAiAction, renderTemplate, type AutomationView, type TemplateVariable } from "./types";

/** The few fields of a matched transaction that messages and prompts may use. */
export interface TxnLite {
  id: number;
  date: string;
  payee: string;
  /** Signed cents: negative = money out. */
  amountCents: number;
  category: string;
  account: string;
}

export interface RunContext {
  now: number;
  timeZone: string;
  trigger: "schedule" | "after_sync" | "manual";
  /** For transaction triggers: what matched. */
  matches?: TxnLite[];
  /** Extra template variables for triggers that aren't a transaction (e.g. the category that went over). */
  vars?: Partial<Record<TemplateVariable, string>>;
  /** Once-only triggers: a `sent` run with the same key means it already fired. */
  dedupeKey?: string;
  deps?: {
    getLlm?: (db: DbLike, model: string | undefined) => FeatureLlm | null;
    send?: typeof sendTo;
    random?: () => number;
  };
}

export type RunOutcome = { status: "sent" | "skipped" | "error"; reason?: string };

/** At most this many separate messages for one run; the rest are summarized in one. */
export const MAX_MESSAGES = 5;
export const MAX_PROMPT_TRANSACTIONS = 20;
export const KEEP_RUNS = 50;
const MAX_ANSWER = 4000;

type Msg = Pick<Notification, "title" | "message" | "severity">;
type Skip = { skip: string };
const skip = (reason: string): Skip => ({ skip: reason });
const isSkip = (v: Msg[] | Skip): v is Skip => !Array.isArray(v);

const txnVars = (t: TxnLite, details: boolean): Partial<Record<TemplateVariable, string>> => ({
  payee: details ? t.payee : "a merchant",
  amount: formatCents(Math.abs(t.amountCents)),
  date: t.date,
  category: t.category,
  account: details ? t.account : "an account",
});

function record(
  db: DbLike,
  a: AutomationView,
  ctx: RunContext,
  out: RunOutcome,
  extra: { preview?: string; aiRunId?: number | null },
) {
  db.transaction((tx) => {
    tx.insert(automationRuns)
      .values({
        automationId: a.id,
        startedAt: ctx.now,
        status: out.status,
        reason: out.reason ?? null,
        dedupeKey: ctx.dedupeKey ?? null,
        aiRunId: extra.aiRunId ?? null,
        preview: extra.preview?.slice(0, 200) ?? null,
      })
      .run();
    tx.update(automations).set({ lastRunAt: ctx.now, lastStatus: out.status }).where(eq(automations.id, a.id)).run();
    const keep = tx
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, a.id))
      .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
      .limit(KEEP_RUNS)
      .all()
      .map((r) => r.id);
    if (keep.length)
      tx.delete(automationRuns)
        .where(and(eq(automationRuns.automationId, a.id), notInArray(automationRuns.id, keep)))
        .run();
  });
}

/**
 * Builds the message(s), sends them and records the run. Never throws: a failure becomes an `error` run with a plain
 * reason (never a URL or provider error text).
 */
export async function runAutomation(db: DbLike, a: AutomationView, ctx: RunContext): Promise<RunOutcome> {
  if (
    ctx.dedupeKey &&
    db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationId, a.id),
          eq(automationRuns.dedupeKey, ctx.dedupeKey),
          eq(automationRuns.status, "sent"),
        ),
      )
      .get()
  )
    return { status: "skipped", reason: "already sent" };

  let aiRunId: number | null = null;
  try {
    const month = currentMonth(ctx.now, ctx.timeZone);
    const report = getSpendingReport(db, { month }, ctx.now, ctx.timeZone);
    const common: Partial<Record<TemplateVariable, string>> = {
      month_spent: formatCents(report.summary.spentCents),
      month_income: formatCents(report.summary.incomeCents),
      today: new Date(ctx.now * 1000).toLocaleDateString("en-CA", { timeZone: ctx.timeZone }),
      ...ctx.vars,
    };
    const action = a.action;
    const details = a.includeDetails;
    let built: Msg[] | Skip;

    if (action.type === "message") {
      const matches = ctx.matches ?? [];
      if (a.trigger.type === "transaction" && matches.length > 0) {
        built = matches.slice(0, MAX_MESSAGES).map((t) => ({
          title: a.name,
          message: renderTemplate(action.text, { ...common, ...txnVars(t, details) }),
        }));
        if (matches.length > MAX_MESSAGES)
          built.push({ title: a.name, message: `…and ${matches.length - MAX_MESSAGES} more.` });
      } else {
        built = [{ title: a.name, message: renderTemplate(action.text, common) }];
      }
    } else if (action.type === "fact") {
      const facts = factsForModel(
        factsForLens(collectFacts(db, { now: ctx.now, timeZone: ctx.timeZone, includeBalances: details }), action.lens),
        details,
      );
      const pick = facts.length
        ? action.pick === "top"
          ? facts[0]
          : facts[Math.floor((ctx.deps?.random ?? Math.random)() * facts.length)]
        : null;
      built = pick ? [{ title: pick.title, message: pick.detail, severity: pick.severity }] : skip("nothing to report");
    } else {
      // AI actions: budget, then the model.
      try {
        assertWithinBudget(db, ctx.now, ctx.timeZone);
      } catch (e) {
        if (e instanceof LlmError) {
          const out = { status: "skipped" as const, reason: "monthly AI budget reached" };
          record(db, a, ctx, out, {});
          return out;
        }
        throw e;
      }
      const picked = (ctx.deps?.getLlm ?? ((d, m) => getLlmFor(d, "automations", m)))(db, a.model ?? undefined);
      if (!picked) {
        const out = { status: "skipped" as const, reason: "AI is off" };
        record(db, a, ctx, out, {});
        return out;
      }
      const llm = trackRuns(db, picked.llm, {
        feature: "automations",
        model: picked.model,
        trigger: "automation",
        subject: `automation ${a.id}`,
        entry: picked.entry,
      });
      const cfg = getAiConfig(db);
      const env = {
        db,
        llm,
        model: picked.model,
        runId: llm.lastRunId,
        now: ctx.now,
        timeZone: ctx.timeZone,
        includeBalances: cfg.includeBalances,
      };
      if (action.type === "ai_insight") {
        const cards = await generateInsightCards(
          { ...env, userName: cfg.userName },
          { lens: action.lens, count: action.count },
        );
        aiRunId = llm.lastRunId();
        built = cards.length
          ? [{ title: a.name, message: cards.map((c) => `${c.title}\n${c.body}`).join("\n\n") }]
          : skip("nothing to report");
      } else {
        const lines = (ctx.matches ?? []).slice(0, MAX_PROMPT_TRANSACTIONS).map((t) => {
          const v = txnVars(t, details);
          return `- ${v.date}, ${v.payee}, ${formatCents(t.amountCents)}, ${v.category}`;
        });
        const prompt = `${action.prompt}${lines.length ? `\n\nTransactions that triggered this:\n${lines.join("\n")}` : ""}`;
        const thread = db
          .insert(aiThreads)
          .values({
            title: `Automation: ${a.name}`.slice(0, 120),
            lens: action.lens,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning()
          .get();
        let answer = "";
        let failure: string | null = null;
        await chat(env, { threadId: thread.id, lens: action.lens, text: prompt, readOnly: true }, (e) => {
          if (e.type === "text") answer += e.text;
          else if (e.type === "error") failure = e.message;
        });
        aiRunId = llm.lastRunId();
        if (failure) {
          const out = { status: "error" as const, reason: failure };
          record(db, a, ctx, out, { aiRunId });
          return out;
        }
        const note = "\n\nFull answer in the Assistant.";
        const text = answer.trim();
        built = text
          ? [
              {
                title: a.name,
                message:
                  text.length > MAX_ANSWER - note.length ? `${text.slice(0, MAX_ANSWER - note.length)}${note}` : text,
              },
            ]
          : skip("the AI had nothing to say");
      }
    }

    if (isSkip(built)) {
      const out = { status: "skipped" as const, reason: built.skip };
      record(db, a, ctx, out, { aiRunId });
      return out;
    }

    const send = ctx.deps?.send ?? sendTo;
    for (const m of built) {
      const res = await send(db, a.destinationId, { event: "automation", ...m });
      if (!res.ok) {
        const out = { status: "error" as const, reason: "The destination didn't accept the message." };
        record(db, a, ctx, out, { aiRunId, preview: built.map((x) => x.message).join("\n") });
        return out;
      }
    }
    const out = { status: "sent" as const };
    record(db, a, ctx, out, { aiRunId, preview: built.map((x) => x.message).join("\n") });
    return out;
  } catch (err) {
    logger.warn({ err, automationId: a.id }, "automation failed");
    const out = {
      status: "error" as const,
      reason: isAiAction(a.action) ? "The AI step failed." : "Something went wrong.",
    };
    try {
      record(db, a, ctx, out, { aiRunId });
    } catch (e) {
      logger.warn({ err: e }, "couldn't record an automation run");
    }
    return out;
  }
}
