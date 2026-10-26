import type { DbLike } from "@/db/open";
import { aiProposals } from "@/db/schema";
import {
  CONFIDENCES,
  buildBatchPrompt,
  collectUncategorized,
  estimateTokens,
  listCategoryChoices,
  type CategoryChoice,
  type Confidence,
  type PayeeGroup,
} from "@/lib/llm/categorize";
import type { ModelEntry } from "@/lib/llm/models";
import type { LlmClient } from "@/lib/llm/types";
import { planForTransaction } from "@/lib/rules/engine";
import { listRules, loadTargets } from "@/lib/rules/store";
import type { Rule } from "@/lib/rules/types";
import { type RuleProposalPayload } from "./proposal-types";
import { hasProposalFor } from "./proposals";
import { candidateRule, categoryAction, choosePattern, loadPreviewData } from "./rule-target";

// Asks the model which category each unknown merchant belongs to, then turns the answers into *proposals for rules*.
// The model never touches a transaction: the owner accepts a rule, and the normal rules engine does the rest.

export const BATCH_SIZE = 40;
const MIN_CONTAINS = 4;
const MAX_CONTAINS = 60;

export const RULE_SYSTEM_PROMPT = `You help a personal-budget app write categorization rules. For each payee choose exactly one category from the list, spelled exactly as written.
- "expense" payees are money going out, "income" payees money coming in (a refund belongs to the category of what was bought).
- confidence: "high" only when the merchant clearly belongs there; "low" when guessing. Prefer "low" to a wild guess.
- Optional "contains": a shorter part of the payee name (at least 4 letters) that would identify this same merchant under other spellings, e.g. "NETFLIX" for "NETFLIX.COM 866-579". Omit it when unsure or when the shorter text could match unrelated merchants.
Reply with JSON only: an array of {"i": <payee number>, "category": "<name>", "confidence": "high"|"medium"|"low", "contains"?: "<text>"}.`;

export interface SuggestPlan {
  /** Merchants that need a rule. */
  eligible: number;
  /** After the per-run cap. */
  toSend: number;
  calls: number;
  estimatedInputTokens: number;
  /** Only when the model entry has prices. */
  estimatedCostMicros: number | null;
}

/** Merchants worth asking about: not asked before, and not already covered by an enabled rule. */
function eligibleGroups(db: DbLike): PayeeGroup[] {
  const groups = collectUncategorized(db);
  const asked = hasProposalFor(
    db,
    groups.map((g) => `category:${g.key}`),
  );
  const rules = listRules(db).filter((r) => r.enabled);
  return groups.filter((g) => {
    if (asked.has(`category:${g.key}`)) return false;
    if (rules.length === 0) return true;
    const [one] = loadTargets(db, [g.ids[0]]);
    // A rule would already set a category: the owner only needs to apply their rules.
    return !(one && planForTransaction(rules, one.target)?.categoryId !== undefined);
  });
}

export function planSuggestions(
  db: DbLike,
  opts: { maxMerchants: number; batchSize?: number; entry?: ModelEntry },
): SuggestPlan & { groups: PayeeGroup[] } {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const all = eligibleGroups(db);
  const groups = all.slice(0, opts.maxMerchants).map((g, index) => ({ ...g, index }));
  const choices = listCategoryChoices(db);
  let inTokens = 0;
  let calls = 0;
  for (let i = 0; i < groups.length; i += batchSize) {
    calls++;
    inTokens += estimateTokens(RULE_SYSTEM_PROMPT + buildBatchPrompt(groups.slice(i, i + batchSize), choices));
  }
  const { inputPerMTok, outputPerMTok } = opts.entry ?? {};
  const outTokens = groups.length * 30;
  return {
    eligible: all.length,
    toSend: groups.length,
    calls,
    estimatedInputTokens: inTokens,
    estimatedCostMicros:
      inputPerMTok !== undefined && outputPerMTok !== undefined
        ? Math.round(inTokens * inputPerMTok + outTokens * outputPerMTok)
        : null,
    groups,
  };
}

export interface RuleAnswer {
  group: PayeeGroup;
  choice: CategoryChoice;
  confidence: Confidence;
  contains?: string;
}

/** Tolerant of fences and chatter. `parsed` is false when no array could be read at all. */
export function parseRuleResponse(
  text: string,
  groups: PayeeGroup[],
  choices: CategoryChoice[],
): { answers: RuleAnswer[]; parsed: boolean } {
  const byName = new Map(choices.map((c) => [c.name.trim().toLowerCase(), c]));
  const byIndex = new Map(groups.map((g) => [g.index, g]));
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let raw: unknown;
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return { answers: [], parsed: false };

  const seen = new Set<number>();
  const answers: RuleAnswer[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const group = typeof item?.i === "number" ? byIndex.get(item.i) : undefined;
    const choice = typeof item?.category === "string" ? byName.get(item.category.trim().toLowerCase()) : undefined;
    const confidence = CONFIDENCES.find((c) => c === item?.confidence);
    if (!group || !choice || !confidence || seen.has(group.index)) continue;
    seen.add(group.index);
    const contains =
      typeof item.contains === "string" &&
      item.contains.trim().length >= MIN_CONTAINS &&
      item.contains.trim().length <= MAX_CONTAINS
        ? item.contains.trim()
        : undefined;
    answers.push({ group, choice, confidence, contains });
  }
  return { answers, parsed: true };
}

export interface SuggestResult {
  created: number;
  noMatch: number;
  unanswered: number;
  calls: number;
  deferred: number;
}

export async function suggestRules(
  env: {
    db: DbLike;
    llm: LlmClient;
    model: string;
    /** The id of the ai_runs row of the call just made (from trackRuns). */
    runId?: () => number | null;
    now: number;
    timeZone: string;
  },
  opts: { maxMerchants: number; batchSize?: number; signal?: AbortSignal },
): Promise<SuggestResult> {
  const { db } = env;
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const plan = planSuggestions(db, { maxMerchants: opts.maxMerchants, batchSize });
  const choices = listCategoryChoices(db);
  const result: SuggestResult = {
    created: 0,
    noMatch: 0,
    unanswered: 0,
    calls: 0,
    deferred: plan.eligible - plan.toSend,
  };
  if (plan.groups.length === 0 || choices.length === 0) return result;

  // Rules as they would stand if every proposal of this run were accepted, so two merchants of the same category
  // target the same rule (the first as "new", the next as "extend").
  let planned: Rule[] = listRules(db);

  for (let i = 0; i < plan.groups.length; i += batchSize) {
    const batch = plan.groups.slice(i, i + batchSize);
    const text = await env.llm.generate({
      system: RULE_SYSTEM_PROMPT,
      user: buildBatchPrompt(batch, choices),
      maxTokens: Math.max(400, batch.length * 50),
      signal: opts.signal,
    });
    result.calls++;
    const { answers, parsed } = parseRuleResponse(text, batch, choices);
    if (!parsed) {
      result.unanswered += batch.length; // stored nothing: these are retried next time
      continue;
    }
    const aiRunId = env.runId?.() ?? null;
    const loaded = loadPreviewData(db); // fresh per batch: earlier batches may have been stored meanwhile
    const answered = new Map(answers.map((a) => [a.group.key, a]));
    const rows: (typeof aiProposals.$inferInsert)[] = [];

    for (const group of batch) {
      const answer = answered.get(group.key);
      const base = {
        kind: "rule" as const,
        source: "rules_job" as const,
        subjectKey: `category:${group.key}`,
        model: env.model,
        aiRunId,
        createdAt: env.now,
      };
      const merchant = {
        key: group.key,
        name: group.payee,
        sample: group.sample,
        direction: group.direction,
        count: group.count,
        medianCents: group.medianCents,
      };
      if (!answer) {
        // Placeholder action: a no_match row only exists so the merchant isn't asked again.
        const payload: RuleProposalPayload = {
          merchant,
          action: categoryAction(choices[0].id, choices[0].name),
          pattern: { op: "equals", value: group.payee },
          target: { mode: "new", ruleName: "" },
        };
        rows.push({ ...base, status: "no_match", payloadJson: JSON.stringify(payload) });
        result.noMatch++;
        continue;
      }
      const action = categoryAction(answer.choice.id, answer.choice.name);
      const { pattern, preview } = choosePattern(db, group, action, answer.contains, env.timeZone, loaded);
      const draft: RuleProposalPayload = {
        merchant,
        action,
        pattern,
        target: { mode: "new", ruleName: "" },
      };
      const { rule, mode } = candidateRule(planned, draft);
      const at = planned.findIndex((r) => r.id === rule.id && r.name === rule.name);
      planned = at >= 0 ? planned.map((r, n) => (n === at ? rule : r)) : [...planned, rule];
      const payload: RuleProposalPayload = {
        ...draft,
        target:
          mode === "extend"
            ? { mode: "extend", ruleId: rule.id, ruleName: rule.name }
            : { mode: "new", ruleName: rule.name },
      };
      rows.push({
        ...base,
        status: "pending",
        confidence: answer.confidence,
        payloadJson: JSON.stringify(payload),
        previewJson: JSON.stringify(preview),
      });
      result.created++;
    }
    db.transaction((tx) => tx.insert(aiProposals).values(rows).run());
  }
  return result;
}
