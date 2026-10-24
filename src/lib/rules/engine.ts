import { normalizePayee, payeeKey } from "@/lib/finance/payee";
import type { Condition, Rule } from "./types";

/** What a rule can see (and change) on a transaction. */
export interface RuleTarget {
  id: number;
  accountId: string;
  description: string;
  payee: string | null;
  payeeOverride: string | null;
  /** Signed cents: negative = money out. */
  amountCents: number;
  categoryId: number | null;
  isTransfer: boolean;
  isExcluded: boolean;
  tagIds: number[];
}

export interface RulePlan {
  categoryId?: number;
  payeeOverride?: string;
  markTransfer?: true;
  exclude?: true;
  addTagIds: number[];
  /** Ids of the rules that contributed, in priority order. */
  matched: number[];
}

const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  let re = regexCache.get(pattern);
  if (re === undefined) {
    try {
      re = new RegExp(pattern, "i");
    } catch {
      re = null;
    }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return re;
}

/**
 * The payee a rule sees: the user's override, else the bank's payee, else the description, cleaned up so that
 * "SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA" matches a rule written for "Blue Bottle Coffee".
 */
export const rulePayee = (t: Pick<RuleTarget, "payeeOverride" | "payee" | "description">) =>
  normalizePayee(t.payeeOverride?.trim() || t.payee?.trim() || t.description);

/** Normalizing is the costly part of matching, and every rule asks for it, so do it once per transaction. */
const payeeCache = new WeakMap<RuleTarget, { text: string; key: string }>();
function payeeOf(t: RuleTarget): { text: string; key: string } {
  let hit = payeeCache.get(t);
  if (!hit) {
    const text = rulePayee(t);
    hit = { text, key: payeeKey(text) };
    payeeCache.set(t, hit);
  }
  return hit;
}

export function conditionMatches(c: Condition, t: RuleTarget): boolean {
  switch (c.field) {
    case "description": {
      const text = t.description;
      if (c.op === "contains") return text.toLowerCase().includes(c.value.toLowerCase());
      if (c.op === "equals") return text.trim().toLowerCase() === c.value.trim().toLowerCase();
      return compile(c.value)?.test(text) ?? false;
    }
    case "payee": {
      const { text, key } = payeeOf(t);
      if (c.op === "contains") {
        const needle = payeeKey(c.value);
        return needle.length > 0 && key.includes(needle);
      }
      if (c.op === "equals") return key === payeeKey(c.value);
      return compile(c.value)?.test(text) ?? false;
    }
    case "amount": {
      // Amounts are compared by size, so "more than $100" matches spending and income alike.
      const abs = Math.abs(t.amountCents);
      if (c.op === "between") return abs >= c.value.min && abs <= c.value.max;
      if (c.op === "gt") return abs > c.value;
      if (c.op === "lt") return abs < c.value;
      return abs === c.value;
    }
    case "account":
      return t.accountId === c.value;
    case "direction":
      return c.value === "expense" ? t.amountCents < 0 : t.amountCents > 0;
  }
}

export function ruleMatches(rule: Pick<Rule, "match" | "conditions">, t: RuleTarget): boolean {
  if (rule.conditions.length === 0) return false;
  return rule.match === "all"
    ? rule.conditions.every((c) => conditionMatches(c, t))
    : rule.conditions.some((c) => conditionMatches(c, t));
}

export interface PlanOptions {
  /** When false (the default for new imports) a rule only fills fields that are still empty. */
  overwrite?: boolean;
}

/**
 * Runs `rules` (already in priority order) against one transaction. Each field is decided by the first matching
 * rule that sets it, so a later rule can't change what an earlier one set. Tags are additive across rules.
 * Returns null when nothing matched.
 */
export function planForTransaction(
  rules: Array<Pick<Rule, "id" | "match" | "conditions" | "actions">>,
  t: RuleTarget,
  opts: PlanOptions = {},
): RulePlan | null {
  const overwrite = opts.overwrite ?? false;
  const plan: RulePlan = { addTagIds: [], matched: [] };
  let claimedCategory = false;
  let claimedPayee = false;
  let any = false;

  for (const rule of rules) {
    if (!ruleMatches(rule, t)) continue;
    any = true;
    plan.matched.push(rule.id);
    const a = rule.actions;
    if (a.categoryId !== undefined && !claimedCategory && (overwrite || t.categoryId === null)) {
      plan.categoryId = a.categoryId;
      claimedCategory = true;
    }
    if (a.payeeOverride !== undefined && !claimedPayee && (overwrite || t.payeeOverride === null)) {
      plan.payeeOverride = a.payeeOverride;
      claimedPayee = true;
    }
    if (a.markTransfer && !t.isTransfer) plan.markTransfer = true;
    if (a.exclude && !t.isExcluded) plan.exclude = true;
    for (const id of a.addTagIds ?? []) if (!plan.addTagIds.includes(id)) plan.addTagIds.push(id);
  }
  return any ? plan : null;
}

/** Whether applying `plan` would actually change `t`. */
export function planChangesTarget(plan: RulePlan | null, t: RuleTarget): boolean {
  if (!plan) return false;
  if (plan.categoryId !== undefined && plan.categoryId !== t.categoryId) return true;
  if (plan.payeeOverride !== undefined && plan.payeeOverride !== t.payeeOverride) return true;
  if (plan.markTransfer && !t.isTransfer) return true;
  if (plan.exclude && !t.isExcluded) return true;
  return plan.addTagIds.some((id) => !t.tagIds.includes(id));
}
