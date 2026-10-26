import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import {
  OPS_FOR_FIELD,
  ruleInputSchema,
  type Condition,
  type ConditionField,
  type Rule,
  type RuleInput,
} from "@/lib/rules/types";

/** The rule builder works with strings (what the user typed); these helpers convert to and from the stored shape. */

export interface ConditionDraft {
  key: string;
  field: ConditionField;
  op: string;
  /** Text value, or the account id / direction, or the amount for gt / lt / equals (in dollars). */
  text: string;
  /** Dollar bounds for "between". */
  min: string;
  max: string;
}

export interface RuleDraft {
  name: string;
  match: "all" | "any";
  conditions: ConditionDraft[];
  categoryId: number | null;
  tagIds: number[];
  payeeOverride: string;
  markTransfer: boolean;
  exclude: boolean;
  enabled: boolean;
}

let counter = 0;
const nextKey = () => `c${++counter}`;

export function newCondition(field: ConditionField = "payee"): ConditionDraft {
  return { key: nextKey(), field, op: OPS_FOR_FIELD[field][0], text: "", min: "", max: "" };
}

export const emptyDraft = (): RuleDraft => ({
  name: "",
  match: "all",
  conditions: [newCondition()],
  categoryId: null,
  tagIds: [],
  payeeOverride: "",
  markTransfer: false,
  exclude: false,
  enabled: true,
});

/** Switching field resets the operator and values, since they rarely carry over meaningfully. */
export function changeField(c: ConditionDraft, field: ConditionField): ConditionDraft {
  return { ...c, field, op: OPS_FOR_FIELD[field][0], text: field === "direction" ? "expense" : "", min: "", max: "" };
}

const dollarsToCents = (s: string): number => Math.abs(parseCents(s.trim().replace(/^\$/, "")));

export type DraftResult = { ok: true; input: RuleInput } | { ok: false; error: string };

/** The typed-in conditions as the stored shape (not yet validated), or what's wrong with them. */
export function conditionsFromDrafts(
  drafts: ConditionDraft[],
): { ok: true; conditions: unknown[] } | { ok: false; error: string } {
  const conditions: unknown[] = [];
  for (const c of drafts) {
    try {
      if (c.field === "amount") {
        if (c.op === "between") {
          if (!c.min.trim() || !c.max.trim()) return { ok: false, error: "Enter both amounts for the range" };
          conditions.push({
            field: "amount",
            op: "between",
            value: { min: dollarsToCents(c.min), max: dollarsToCents(c.max) },
          });
        } else {
          if (!c.text.trim()) return { ok: false, error: "Enter an amount" };
          conditions.push({ field: "amount", op: c.op, value: dollarsToCents(c.text) });
        }
      } else {
        conditions.push({ field: c.field, op: c.op, value: c.text });
      }
    } catch {
      return { ok: false, error: "Amounts should look like 25.00" };
    }
  }
  return { ok: true, conditions };
}

export function draftToInput(draft: RuleDraft): DraftResult {
  const built = conditionsFromDrafts(draft.conditions);
  if (!built.ok) return built;
  const conditions = built.conditions;

  const actions: Record<string, unknown> = {};
  if (draft.categoryId !== null) actions.categoryId = draft.categoryId;
  if (draft.tagIds.length) actions.addTagIds = draft.tagIds;
  if (draft.payeeOverride.trim()) actions.payeeOverride = draft.payeeOverride.trim();
  if (draft.markTransfer) actions.markTransfer = true;
  if (draft.exclude) actions.exclude = true;

  const parsed = ruleInputSchema.safeParse({
    name: draft.name,
    match: draft.match,
    conditions,
    actions,
    enabled: draft.enabled,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "This rule isn't complete yet" };
  return { ok: true, input: parsed.data };
}

/** Stored conditions as typed-in drafts, for editing. */
export function draftsFromConditions(conditions: Condition[]): ConditionDraft[] {
  return conditions.map((c) => {
    const base = { key: nextKey(), field: c.field, op: c.op, text: "", min: "", max: "" } as ConditionDraft;
    if (c.field === "amount") {
      if (c.op === "between")
        return { ...base, min: centsToDecimalString(c.value.min), max: centsToDecimalString(c.value.max) };
      return { ...base, text: centsToDecimalString(c.value) };
    }
    return { ...base, text: String(c.value) };
  });
}

export function ruleToDraft(rule: Rule): RuleDraft {
  return {
    name: rule.name,
    match: rule.match,
    enabled: rule.enabled,
    conditions: draftsFromConditions(rule.conditions),
    categoryId: rule.actions.categoryId ?? null,
    tagIds: rule.actions.addTagIds ?? [],
    payeeOverride: rule.actions.payeeOverride ?? "",
    markTransfer: rule.actions.markTransfer === true,
    exclude: rule.actions.exclude === true,
  };
}
