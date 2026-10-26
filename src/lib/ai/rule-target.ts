import type { DbLike } from "@/db/open";
import { categories } from "@/db/schema";
import { localDateString } from "@/lib/finance/dates";
import { payeeKey } from "@/lib/finance/payee";
import type { PayeeGroup } from "@/lib/llm/categorize";
import { conditionMatches, rulePayee } from "@/lib/rules/engine";
import { applyRules, loadTargets } from "@/lib/rules/store";
import { MAX_CONDITIONS, type Condition, type Rule, type RuleActions } from "@/lib/rules/types";
import type { ProposalPreview, RuleAction, RuleProposalPayload } from "./proposal-types";

const MIN_CONTAINS_KEY_LENGTH = 4;

export function actionsFor(action: RuleAction): RuleActions {
  return action.type === "category" ? { categoryId: action.categoryId } : { addTagIds: [action.tagId] };
}

const sameActions = (a: RuleActions, b: RuleActions) => JSON.stringify(a) === JSON.stringify(b);

/** The first rule that can take one more payee condition for this action, or null. */
export function findExtendableRule(rules: Rule[], action: RuleAction): Rule | null {
  const wanted = actionsFor(action);
  return (
    rules.find(
      (r) =>
        r.enabled &&
        r.match === "any" &&
        r.conditions.length < MAX_CONDITIONS &&
        r.conditions.every((c) => c.field === "payee" && (c.op === "equals" || c.op === "contains")) &&
        sameActions(r.actions, wanted),
    ) ?? null
  );
}

/** "AI · Dining", or "AI · Dining 2" when that name is taken by a rule that can't be extended. */
export function newRuleName(rules: Rule[], label: string, prefix = "AI"): string {
  const taken = new Set(rules.map((r) => r.name));
  const base = `${prefix} · ${label}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

const conditionOf = (p: RuleProposalPayload["pattern"]): Condition => ({ field: "payee", op: p.op, value: p.value });

const sameCondition = (a: Condition, b: Condition) => JSON.stringify(a) === JSON.stringify(b);

/** The rule (as it would be saved) once the proposal is applied: the extended rule or a new one. */
export function candidateRule(rules: Rule[], payload: RuleProposalPayload): { rule: Rule; mode: "extend" | "new" } {
  const cond = conditionOf(payload.pattern);
  const ext = findExtendableRule(rules, payload.action);
  if (ext) {
    const conditions = ext.conditions.some((c) => sameCondition(c, cond)) ? ext.conditions : [...ext.conditions, cond];
    return { rule: { ...ext, conditions }, mode: "extend" };
  }
  const label = payload.action.type === "category" ? payload.action.categoryName : payload.action.tagName;
  const name = newRuleName(rules, label, payload.action.type === "category" ? "AI" : "AI tag");
  return {
    rule: {
      id: 0,
      name,
      priority: rules.reduce((m, r) => Math.max(m, r.priority), -1) + 1,
      enabled: true,
      match: "any",
      conditions: [cond],
      actions: actionsFor(payload.action),
    },
    mode: "new",
  };
}

function previewCondition(db: DbLike, cond: Condition, action: RuleAction, timeZone: string): ProposalPreview {
  const actions = actionsFor(action);
  const rule: Rule = { id: 0, name: "", priority: 0, enabled: true, match: "all", conditions: [cond], actions };
  const { matched, changed } = applyRules(db, { rules: [rule], dryRun: true, overwrite: false });
  const out: ProposalPreview = { matched, wouldChange: changed, conflicts: 0, conflictSamples: [] };
  if (action.type !== "category") return out; // tags are additive: nothing to conflict with

  const names = new Map(
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );
  for (const { target, at } of loadTargets(db)) {
    if (!conditionMatches(cond, target)) continue;
    if (target.categoryId === null || target.categoryId === action.categoryId) continue;
    out.conflicts++;
    if (out.conflictSamples.length < 3) {
      out.conflictSamples.push({
        date: localDateString(at, timeZone),
        payee: rulePayee(target),
        category: names.get(target.categoryId) ?? "another category",
      });
    }
  }
  return out;
}

/** Dry-run counts for just the new condition with this action, plus conflicts. */
export function previewProposal(db: DbLike, payload: RuleProposalPayload, timeZone: string): ProposalPreview {
  return previewCondition(db, conditionOf(payload.pattern), payload.action, timeZone);
}

/**
 * Prefers the model's shorter `contains` text, but falls back to `equals` on the payee when it is too short to be
 * safe or would touch transactions the owner categorized differently.
 */
export function choosePattern(
  db: DbLike,
  group: Pick<PayeeGroup, "payee">,
  action: RuleAction,
  suggestedContains: string | undefined,
  timeZone: string,
): { pattern: RuleProposalPayload["pattern"]; preview: ProposalPreview } {
  const equals = { op: "equals", value: group.payee } as const;
  const contains = suggestedContains?.trim();
  if (contains && payeeKey(contains).length >= MIN_CONTAINS_KEY_LENGTH) {
    const pattern = { op: "contains", value: contains } as const;
    const preview = previewCondition(db, conditionOf(pattern), action, timeZone);
    if (preview.conflicts === 0) return { pattern, preview };
  }
  return { pattern: equals, preview: previewCondition(db, conditionOf(equals), action, timeZone) };
}

export const categoryAction = (categoryId: number, categoryName: string): RuleAction => ({
  type: "category",
  categoryId,
  categoryName,
});
