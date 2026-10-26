import type { DbLike } from "@/db/open";
import { categories } from "@/db/schema";
import { localDateString } from "@/lib/finance/dates";
import { payeeKey } from "@/lib/finance/payee";
import type { PayeeGroup } from "@/lib/llm/categorize";
import { conditionMatches, rulePayee } from "@/lib/rules/engine";
import { loadTargets } from "@/lib/rules/store";
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

type LoadedTargets = ReturnType<typeof loadTargets>;

function categoryNames(db: DbLike): Map<number, string> {
  return new Map(
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );
}

/** Same numbers as a dry-run `applyRules` over just this condition, computed on already-loaded transactions. */
function previewOn(
  targets: LoadedTargets,
  names: Map<number, string>,
  cond: Condition,
  action: RuleAction,
  timeZone: string,
): ProposalPreview {
  const out: ProposalPreview = { matched: 0, wouldChange: 0, conflicts: 0, conflictSamples: [] };
  for (const { target, at } of targets) {
    if (!conditionMatches(cond, target)) continue;
    out.matched++;
    if (action.type === "tag") {
      // Tags are additive: nothing to conflict with.
      if (!target.tagIds.includes(action.tagId)) out.wouldChange++;
      continue;
    }
    if (target.categoryId === null) out.wouldChange++;
    else if (target.categoryId !== action.categoryId) {
      out.conflicts++;
      if (out.conflictSamples.length < 3) {
        out.conflictSamples.push({
          date: localDateString(at, timeZone),
          payee: rulePayee(target),
          category: names.get(target.categoryId) ?? "another category",
        });
      }
    }
  }
  return out;
}

/** Dry-run counts for just the new condition with this action, plus conflicts. */
export function previewProposal(db: DbLike, payload: RuleProposalPayload, timeZone: string): ProposalPreview {
  return previewOn(loadTargets(db), categoryNames(db), conditionOf(payload.pattern), payload.action, timeZone);
}

/** Previews for many proposals with one scan of the transactions. */
export function previewProposals(db: DbLike, payloads: RuleProposalPayload[], timeZone: string): ProposalPreview[] {
  if (payloads.length === 0) return [];
  const targets = loadTargets(db);
  const names = categoryNames(db);
  return payloads.map((p) => previewOn(targets, names, conditionOf(p.pattern), p.action, timeZone));
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
  loaded?: { targets: LoadedTargets; names: Map<number, string> },
): { pattern: RuleProposalPayload["pattern"]; preview: ProposalPreview } {
  const { targets, names } = loaded ?? { targets: loadTargets(db), names: categoryNames(db) };
  const equals = { op: "equals", value: group.payee } as const;
  const contains = suggestedContains?.trim();
  if (contains && payeeKey(contains).length >= MIN_CONTAINS_KEY_LENGTH) {
    const pattern = { op: "contains", value: contains } as const;
    const preview = previewOn(targets, names, conditionOf(pattern), action, timeZone);
    if (preview.conflicts === 0) return { pattern, preview };
  }
  return { pattern: equals, preview: previewOn(targets, names, conditionOf(equals), action, timeZone) };
}

export const loadPreviewData = (db: DbLike) => ({ targets: loadTargets(db), names: categoryNames(db) });

export const categoryAction = (categoryId: number, categoryName: string): RuleAction => ({
  type: "category",
  categoryId,
  categoryName,
});
