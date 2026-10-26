import "server-only";
import { and, asc, count, desc, eq, gt, lte } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiMessages, aiProposals, aiRuns, aiThreads } from "@/db/schema";
import { localDateString, currentMonth } from "@/lib/finance/dates";
import { logger } from "@/lib/logger";
import { buildAiContext } from "@/lib/llm/context";
import { BASE_SYSTEM } from "@/lib/llm/narrative";
import { LLM_TOOLS, createToolRunner } from "@/lib/llm/tools";
import { LlmError, type ChatTurn, type LlmClient, type LlmTool } from "@/lib/llm/types";
import { LENSES, isLensId, type LensId } from "./lenses";
import { memoryPromptBlock } from "./memory";
import type { AnyProposalView } from "./proposal-types";
import { listThreadProposals } from "./proposals";
import { PROPOSE_TOOLS, createProposeRunner } from "./propose-tools";

export class AssistantError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const HISTORY_MESSAGES = 12;
/** Past this many messages the older ones are folded into a rolling summary. */
export const SUMMARY_THRESHOLD = 24;
export const MAX_TEXT_CHARS = 2_000;

export type ChatEvent =
  | { type: "thread"; threadId: number }
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: AnyProposalView }
  | { type: "done"; messageId: number; costMicros: number | null }
  | { type: "error"; message: string };

export interface ChatEnv {
  db: DbLike;
  /** Normally wrapped with trackRuns so `runId` can report the row of the last call. */
  llm: LlmClient;
  model: string;
  runId?: () => number | null;
  now: number;
  timeZone: string;
  includeBalances: boolean;
}

const PROPOSAL_RULES =
  "To change anything (a rule, a memory, a target) call a propose_ tool. Never say a change is done: the owner applies it with a button. If a propose_ tool returns an error, tell the owner plainly what is missing.";

/**
 * The stable part of the system prompt: nothing in it depends on the date, so providers that cache prompt prefixes
 * can reuse it. Order: base rules, lens, tool guide, proposal rules, memories.
 */
export function stablePrompt(db: DbLike, lens: LensId, tools: LlmTool[]): string {
  const l = LENSES[lens];
  const guide = tools.length
    ? `Tools you may call:\n${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
    : "";
  const proposes = l.proposals.length ? PROPOSAL_RULES : "You cannot change anything; only answer.";
  return [BASE_SYSTEM, `Focus (${l.label}): ${l.instructions}`, guide, proposes, memoryPromptBlock(db)]
    .filter(Boolean)
    .join("\n\n");
}

export function toolsForLens(lens: LensId): { read: LlmTool[]; propose: LlmTool[] } {
  const l = LENSES[lens];
  return {
    read: LLM_TOOLS.filter((t) => l.tools.includes(t.name)),
    propose: l.proposals.map((p) => PROPOSE_TOOLS[p]),
  };
}

export function getThreadOrThrow(db: DbLike, id: number) {
  const t = db.select().from(aiThreads).where(eq(aiThreads.id, id)).get();
  if (!t) throw new AssistantError("not_found", "Conversation not found");
  return t;
}

function costOf(db: DbLike, runId: number | null): number | null {
  if (runId === null) return null;
  return db.select({ c: aiRuns.costMicros }).from(aiRuns).where(eq(aiRuns.id, runId)).get()?.c ?? null;
}

/** One user turn: saves it, answers (streaming through `emit`), saves the answer and keeps the summary current. */
export async function chat(
  env: ChatEnv,
  input: { threadId?: number; lens: LensId; text: string },
  emit: (e: ChatEvent) => void,
): Promise<void> {
  const { db } = env;
  const text = input.text.trim();
  if (!text || text.length > MAX_TEXT_CHARS)
    throw new AssistantError("invalid", "Write between 1 and 2000 characters.");

  const thread = input.threadId
    ? getThreadOrThrow(db, input.threadId)
    : db
        .insert(aiThreads)
        .values({ title: text.slice(0, 60), lens: input.lens, createdAt: env.now, updatedAt: env.now })
        .returning()
        .get();
  emit({ type: "thread", threadId: thread.id });
  const lens: LensId = isLensId(thread.lens) ? thread.lens : "general";

  const userMessage = db
    .insert(aiMessages)
    .values({ threadId: thread.id, role: "user", content: text, createdAt: env.now })
    .returning()
    .get();

  const history: ChatTurn[] = db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, thread.id), lte(aiMessages.id, userMessage.id - 1)))
    .orderBy(desc(aiMessages.id))
    .limit(HISTORY_MESSAGES)
    .all()
    .reverse();

  const { read, propose } = toolsForLens(lens);
  const month = currentMonth(env.now, env.timeZone);
  const summary = buildAiContext(db, {
    now: env.now,
    timeZone: env.timeZone,
    month,
    includeBalances: env.includeBalances,
  });
  const system = `${stablePrompt(db, lens, [...read, ...propose])}\n\nToday is ${localDateString(env.now, env.timeZone)}.${
    thread.summary ? `\nEarlier in this conversation: ${thread.summary}` : ""
  }\nSummary of this month:\n${JSON.stringify(summary)}`;

  const readRunner = createToolRunner(db, env.now, env.timeZone, env.includeBalances);
  const proposeRunner = createProposeRunner(
    db,
    {
      threadId: thread.id,
      model: env.model,
      runId: () => env.runId?.() ?? null,
      now: env.now,
      timeZone: env.timeZone,
    },
    (proposal) => emit({ type: "proposal", proposal }),
  );
  const used = new Set<string>();
  const runTool = (name: string, args: unknown) => {
    used.add(name);
    return name in PROPOSE_TOOLS ? proposeRunner(name, args) : readRunner(name, args);
  };

  let answer: string;
  try {
    answer = await env.llm.generate({
      system,
      history,
      user: text,
      tools: [...read, ...propose],
      runTool,
      onText: (delta) => emit({ type: "text", text: delta }),
      maxTokens: 1500,
    });
  } catch (e) {
    if (e instanceof LlmError) {
      emit({ type: "error", message: e.message });
      return;
    }
    throw e;
  }

  const runId = env.runId?.() ?? null;
  const saved = db
    .insert(aiMessages)
    .values({
      threadId: thread.id,
      role: "assistant",
      content: answer || "I don't have an answer for that.",
      model: env.model,
      aiRunId: runId,
      toolsJson: used.size ? JSON.stringify([...used]) : null,
      createdAt: env.now,
    })
    .returning()
    .get();
  db.update(aiThreads).set({ updatedAt: env.now }).where(eq(aiThreads.id, thread.id)).run();
  emit({ type: "done", messageId: saved.id, costMicros: costOf(db, runId) });

  await maybeSummarize(env, thread.id);
}

/** Folds everything but the last 12 messages into the thread's summary once the thread is long. Never throws. */
async function maybeSummarize(env: ChatEnv, threadId: number): Promise<void> {
  const { db } = env;
  try {
    const total = db.select({ n: count() }).from(aiMessages).where(eq(aiMessages.threadId, threadId)).get()?.n ?? 0;
    if (total <= SUMMARY_THRESHOLD) return;
    const ids = db
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(eq(aiMessages.threadId, threadId))
      .orderBy(asc(aiMessages.id))
      .all();
    const boundary = ids[ids.length - HISTORY_MESSAGES - 1].id;
    const thread = getThreadOrThrow(db, threadId);
    if ((thread.summaryUpTo ?? 0) >= boundary) return;
    const older = db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.threadId, threadId),
          gt(aiMessages.id, thread.summaryUpTo ?? 0),
          lte(aiMessages.id, boundary),
        ),
      )
      .orderBy(asc(aiMessages.id))
      .all();
    const transcript = older.map((m) => `${m.role === "user" ? "Owner" : "Assistant"}: ${m.content}`).join("\n");
    const summary = await env.llm.generate({
      system: "You summarize conversations for a budgeting assistant.",
      user: `Summarize this conversation's earlier part in under 120 words, keeping figures and decisions.\n\n${thread.summary ? `Summary so far: ${thread.summary}\n\n` : ""}${transcript}`,
      maxTokens: 300,
    });
    if (summary.trim())
      db.update(aiThreads)
        .set({ summary: summary.trim(), summaryUpTo: boundary })
        .where(eq(aiThreads.id, threadId))
        .run();
  } catch (err) {
    logger.warn({ err }, "conversation summary failed");
  }
}

export function listThreads(db: DbLike) {
  return db
    .select({ id: aiThreads.id, title: aiThreads.title, lens: aiThreads.lens, updatedAt: aiThreads.updatedAt })
    .from(aiThreads)
    .orderBy(desc(aiThreads.updatedAt), desc(aiThreads.id))
    .limit(100)
    .all();
}

export function getThread(db: DbLike, id: number, timeZone: string) {
  const thread = getThreadOrThrow(db, id);
  const messages = db
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      content: aiMessages.content,
      model: aiMessages.model,
      costMicros: aiRuns.costMicros,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .leftJoin(aiRuns, eq(aiRuns.id, aiMessages.aiRunId))
    .where(eq(aiMessages.threadId, id))
    .orderBy(asc(aiMessages.id))
    .all();
  return {
    thread: { id: thread.id, title: thread.title, lens: thread.lens, updatedAt: thread.updatedAt },
    messages,
    proposals: listThreadProposals(db, id, timeZone),
  };
}

export function renameThread(db: DbLike, id: number, title: string): void {
  const t = title.trim();
  if (!t || t.length > 120) throw new AssistantError("invalid", "Use a title of 1 to 120 characters.");
  getThreadOrThrow(db, id);
  db.update(aiThreads).set({ title: t }).where(eq(aiThreads.id, id)).run();
}

/** Deletes the conversation and its messages; proposals it made stay but forget the thread. */
export function deleteThread(db: DbLike, id: number): void {
  getThreadOrThrow(db, id);
  db.transaction((tx) => {
    tx.update(aiProposals).set({ threadId: null }).where(eq(aiProposals.threadId, id)).run();
    tx.delete(aiMessages).where(eq(aiMessages.threadId, id)).run();
    tx.delete(aiThreads).where(eq(aiThreads.id, id)).run();
  });
}
