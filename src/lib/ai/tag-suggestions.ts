import { and, asc, eq, gte, like, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiProposals, tags, transactions } from "@/db/schema";
import { formatCents } from "@/lib/finance/cents";
import { normalizePayee } from "@/lib/finance/payee";
import { effectiveDateSql } from "@/lib/finance/sql";
import { CONFIDENCES, estimateTokens, type Confidence } from "@/lib/llm/categorize";
import type { LlmClient } from "@/lib/llm/types";
import { planForTransaction } from "@/lib/rules/engine";
import { listRules, loadTargets } from "@/lib/rules/store";
import type { Rule } from "@/lib/rules/types";
import type { RuleProposalPayload } from "./proposal-types";
import { candidateRule, choosePattern, loadPreviewData } from "./rule-target";

// Tags are the second step: existing tags only, merchants seen at least twice recently, no conflict concept.

export const TAG_WINDOW_DAYS = 180;
export const TAG_BATCH_SIZE = 40;

export const TAG_SYSTEM_PROMPT = `You help a personal-budget app tag recurring merchants. For each merchant, list the tags from the given list that clearly apply, or none. Most merchants get none. Use tag names exactly as written; never invent tags.
confidence: "high" only when the tag clearly applies; "low" when guessing.
Reply with JSON only: an array of {"i": <merchant number>, "tags": ["<tag name>", ...], "confidence": "high"|"medium"|"low"}.`;

export interface TagMerchant {
  index: number;
  /** transactions.merchant_key */
  key: string;
  name: string;
  sample: string;
  count: number;
  medianCents: number;
  direction: "expense" | "income";
}

/** Merchants (≥ 2 transactions in the last 180 days) with no tag rule and no earlier tag suggestion, biggest spend first. */
export function collectTagMerchants(db: DbLike, now: number): TagMerchant[] {
  const rows = db
    .select({
      id: transactions.id,
      key: transactions.merchantKey,
      description: transactions.description,
      payee: transactions.payee,
      payeeOverride: transactions.payeeOverride,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.isTransfer, false),
        eq(transactions.isExcluded, false),
        gte(effectiveDateSql, now - TAG_WINDOW_DAYS * 86_400),
      ),
    )
    .orderBy(sql`${effectiveDateSql} desc`, sql`${transactions.id} desc`)
    .all();

  const asked = new Set(
    db
      .select({ key: aiProposals.subjectKey })
      .from(aiProposals)
      .where(
        and(like(aiProposals.subjectKey, "tag:%"), inArray(aiProposals.status, ["pending", "dismissed", "no_match"])),
      )
      .all()
      .map((r) => r.key?.split(":")[1] ?? ""),
  );

  const byKey = new Map<string, { first: (typeof rows)[number]; ids: number[]; amounts: number[]; net: number }>();
  for (const r of rows) {
    if (!r.key || asked.has(r.key)) continue;
    const g = byKey.get(r.key) ?? { first: r, ids: [], amounts: [], net: 0 };
    g.ids.push(r.id);
    g.amounts.push(Math.abs(r.amountCents));
    g.net += r.amountCents;
    byKey.set(r.key, g);
  }

  const tagRules = listRules(db).filter((r) => r.enabled && (r.actions.addTagIds?.length ?? 0) > 0);
  return [...byKey.entries()]
    .filter(([, g]) => g.ids.length >= 2)
    .filter(([, g]) => {
      if (tagRules.length === 0) return true;
      const [one] = loadTargets(db, [g.ids[0]]);
      return !(one && (planForTransaction(tagRules, one.target)?.addTagIds.length ?? 0) > 0);
    })
    .sort(([, a], [, b]) => b.amounts.reduce((x, y) => x + y, 0) - a.amounts.reduce((x, y) => x + y, 0))
    .map(([key, g], index) => {
      const amounts = [...g.amounts].sort((x, y) => x - y);
      const name =
        normalizePayee(g.first.payeeOverride?.trim() || g.first.payee?.trim() || g.first.description) ||
        g.first.description;
      return {
        index,
        key,
        name,
        sample: g.first.description,
        count: g.ids.length,
        medianCents: amounts[Math.floor(amounts.length / 2)],
        direction: g.net > 0 ? ("income" as const) : ("expense" as const),
      };
    });
}

export function buildTagPrompt(merchants: TagMerchant[], tagNames: string[]): string {
  const lines = merchants.map(
    (m) =>
      `${m.index}. ${m.name}${m.sample !== m.name ? ` [bank text: ${m.sample.slice(0, 80)}]` : ""} | ${m.direction} | ~${formatCents(m.medianCents)} | ${m.count}x`,
  );
  return `Tags:\n${tagNames.map((t) => `- ${t}`).join("\n")}\n\nMerchants (number. name | direction | typical amount | how many):\n${lines.join("\n")}`;
}

export interface TagAnswer {
  merchant: TagMerchant;
  tags: { id: number; name: string }[];
  confidence: Confidence;
}

export function parseTagResponse(
  text: string,
  merchants: TagMerchant[],
  tagChoices: { id: number; name: string }[],
): { answers: TagAnswer[]; parsed: boolean } {
  const byName = new Map(tagChoices.map((t) => [t.name.trim().toLowerCase(), t]));
  const byIndex = new Map(merchants.map((m) => [m.index, m]));
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
  const answers: TagAnswer[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const merchant = typeof item?.i === "number" ? byIndex.get(item.i) : undefined;
    const confidence = CONFIDENCES.find((c) => c === item?.confidence);
    if (!merchant || !confidence || !Array.isArray(item.tags) || seen.has(merchant.index)) continue;
    seen.add(merchant.index);
    const picked = new Map<number, { id: number; name: string }>();
    for (const t of item.tags) {
      const found = typeof t === "string" ? byName.get(t.trim().toLowerCase()) : undefined;
      if (found) picked.set(found.id, found);
    }
    answers.push({ merchant, tags: [...picked.values()], confidence });
  }
  return { answers, parsed: true };
}

export interface TagSuggestResult {
  created: number;
  noMatch: number;
  unanswered: number;
  calls: number;
  /** Why nothing was asked, when that is the case. */
  skipped?: "no_tags" | "none_eligible";
}

export async function suggestTagRules(
  env: {
    db: DbLike;
    llm: LlmClient;
    model: string;
    runId?: () => number | null;
    now: number;
    timeZone: string;
  },
  opts: { maxMerchants: number; batchSize?: number; signal?: AbortSignal },
): Promise<TagSuggestResult> {
  const { db } = env;
  const out: TagSuggestResult = { created: 0, noMatch: 0, unanswered: 0, calls: 0 };
  const tagChoices = db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name)).all();
  if (tagChoices.length === 0) return { ...out, skipped: "no_tags" };
  const merchants = collectTagMerchants(db, env.now)
    .slice(0, opts.maxMerchants)
    .map((m, index) => ({ ...m, index }));
  if (merchants.length === 0) return { ...out, skipped: "none_eligible" };

  const batchSize = opts.batchSize ?? TAG_BATCH_SIZE;
  let planned: Rule[] = listRules(db);
  for (let i = 0; i < merchants.length; i += batchSize) {
    const batch = merchants.slice(i, i + batchSize);
    const text = await env.llm.generate({
      system: TAG_SYSTEM_PROMPT,
      user: buildTagPrompt(
        batch,
        tagChoices.map((t) => t.name),
      ),
      maxTokens: Math.max(400, batch.length * 50),
      signal: opts.signal,
    });
    out.calls++;
    const { answers, parsed } = parseTagResponse(text, batch, tagChoices);
    if (!parsed) {
      out.unanswered += batch.length;
      continue;
    }
    const aiRunId = env.runId?.() ?? null;
    const loaded = loadPreviewData(db);
    const answered = new Map(answers.map((a) => [a.merchant.key, a]));
    const rows: (typeof aiProposals.$inferInsert)[] = [];
    for (const m of batch) {
      const base = {
        kind: "rule" as const,
        source: "rules_job" as const,
        model: env.model,
        aiRunId,
        createdAt: env.now,
      };
      const merchant = {
        key: m.key,
        name: m.name,
        sample: m.sample,
        direction: m.direction,
        count: m.count,
        medianCents: m.medianCents,
      };
      const answer = answered.get(m.key);
      if (!answer || answer.tags.length === 0) {
        const placeholder: RuleProposalPayload = {
          merchant,
          action: { type: "tag", tagId: tagChoices[0].id, tagName: tagChoices[0].name },
          pattern: { op: "equals", value: m.name },
          target: { mode: "new", ruleName: "" },
        };
        rows.push({
          ...base,
          status: "no_match",
          subjectKey: `tag:${m.key}`,
          payloadJson: JSON.stringify(placeholder),
        });
        out.noMatch++;
        continue;
      }
      for (const t of answer.tags) {
        const action = { type: "tag" as const, tagId: t.id, tagName: t.name };
        const { pattern, preview } = choosePattern(db, { payee: m.name }, action, undefined, env.timeZone, loaded);
        const draft: RuleProposalPayload = { merchant, action, pattern, target: { mode: "new", ruleName: "" } };
        const { rule, mode } = candidateRule(planned, draft);
        const at = planned.findIndex((r) => r.id === rule.id && r.name === rule.name);
        planned = at >= 0 ? planned.map((r, n) => (n === at ? rule : r)) : [...planned, rule];
        rows.push({
          ...base,
          status: "pending",
          subjectKey: `tag:${m.key}:${t.id}`,
          confidence: answer.confidence,
          payloadJson: JSON.stringify({
            ...draft,
            target:
              mode === "extend"
                ? { mode: "extend", ruleId: rule.id, ruleName: rule.name }
                : { mode: "new", ruleName: rule.name },
          } satisfies RuleProposalPayload),
          previewJson: JSON.stringify(preview),
        });
        out.created++;
      }
    }
    db.transaction((tx) => tx.insert(aiProposals).values(rows).run());
  }
  return out;
}

/** Rough size of a tag run, for the plan line. */
export const estimateTagTokens = (merchants: TagMerchant[], tagNames: string[]) =>
  estimateTokens(TAG_SYSTEM_PROMPT + buildTagPrompt(merchants, tagNames));
