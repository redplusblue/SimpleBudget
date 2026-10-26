import "server-only";
import type { DbLike } from "@/db/open";
import { traceTransaction } from "@/lib/finance/trace";
import { BASE_SYSTEM } from "@/lib/llm/narrative";
import { LLM_TOOLS, createToolRunner } from "@/lib/llm/tools";
import { LlmError, type LlmClient } from "@/lib/llm/types";
import { AssistantError } from "./assistant";
import { memoryPromptBlock } from "./memory";
import type { AnyProposalView } from "./proposal-types";
import { PROPOSE_TOOLS, createProposeRunner } from "./propose-tools";
import { traceForModel } from "./trace-model";

export const TRACE_SYSTEM = `${BASE_SYSTEM}

You explain one transaction in the context of the owner's history with this merchant. Start from the statistics given. Call a tool only if the statistics don't answer the question. Answer in under 150 words: what this charge is, whether it is normal for this merchant, and anything worth doing (a price increase, a duplicate, a missing rule). To change anything call a propose_ tool; never say a change is done, the owner applies it with a button.`;

export const DEFAULT_QUESTION = "Is this charge normal, and is there anything I should do?";

export type TraceEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: AnyProposalView }
  | { type: "done"; costMicros: number | null }
  | { type: "error"; message: string };

export interface TraceExplainEnv {
  db: DbLike;
  llm: LlmClient;
  model: string;
  runId?: () => number | null;
  now: number;
  timeZone: string;
  includeBalances: boolean;
}

const READ_TOOLS = ["get_merchant_history", "search_transactions", "get_recurring"];

/** Explains one transaction from its computed trace. Pressed by the owner; the model may call tools for more. */
export async function explainTrace(
  env: TraceExplainEnv,
  id: number,
  question: string | undefined,
  emit: (e: TraceEvent) => void,
  costOf: () => number | null = () => null,
): Promise<void> {
  const { db } = env;
  const trace = traceTransaction(db, id, env.now, env.timeZone);
  if (!trace) throw new AssistantError("not_found", "Transaction not found");

  const memories = memoryPromptBlock(db);
  const read = LLM_TOOLS.filter((t) => READ_TOOLS.includes(t.name));
  const propose = [PROPOSE_TOOLS.propose_rule, PROPOSE_TOOLS.propose_memory];
  const readRunner = createToolRunner(db, env.now, env.timeZone, env.includeBalances);
  const proposeRunner = createProposeRunner(
    db,
    { threadId: null, model: env.model, runId: () => env.runId?.() ?? null, now: env.now, timeZone: env.timeZone },
    (proposal) => emit({ type: "proposal", proposal }),
  );
  try {
    await env.llm.generate({
      system: `${TRACE_SYSTEM}${memories ? `\n\n${memories}` : ""}`,
      user: `Statistics about this merchant and this charge:\n${JSON.stringify(traceForModel(trace))}\n\n${question?.trim() || DEFAULT_QUESTION}`,
      tools: [...read, ...propose],
      runTool: (name, args) => (name in PROPOSE_TOOLS ? proposeRunner(name, args) : readRunner(name, args)),
      onText: (text) => emit({ type: "text", text }),
      maxTokens: 600,
    });
  } catch (e) {
    if (e instanceof LlmError) {
      emit({ type: "error", message: e.message });
      return;
    }
    throw e;
  }
  emit({ type: "done", costMicros: costOf() });
}
