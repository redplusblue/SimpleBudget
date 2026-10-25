import { formatCents } from "@/lib/finance/cents";
import { FIELD_LABELS, OP_LABELS, type Condition, type Rule } from "@/lib/rules/types";

export interface Names {
  account: (id: string) => string | undefined;
  category: (id: number) => string | undefined;
  tag: (id: number) => string | undefined;
}

export function describeCondition(c: Condition, names: Pick<Names, "account">): string {
  const field = FIELD_LABELS[c.field].toLowerCase();
  switch (c.field) {
    case "description":
    case "payee":
      return `${field} ${OP_LABELS[c.op]} “${c.value}”`;
    case "amount":
      return c.op === "between"
        ? `amount is between ${formatCents(c.value.min)} and ${formatCents(c.value.max)}`
        : `amount ${OP_LABELS[c.op]} ${formatCents(c.value)}`;
    case "account":
      return `account is ${names.account(c.value) ?? "a removed account"}`;
    case "direction":
      return c.value === "expense" ? "money goes out" : "money comes in";
  }
}

export function describeActions(a: Rule["actions"], names: Pick<Names, "category" | "tag">): string[] {
  const out: string[] = [];
  if (a.categoryId !== undefined) out.push(`set category to ${names.category(a.categoryId) ?? "a removed category"}`);
  for (const id of a.addTagIds ?? []) out.push(`add tag ${names.tag(id) ?? "a removed tag"}`);
  if (a.payeeOverride) out.push(`rename payee to “${a.payeeOverride}”`);
  if (a.markTransfer) out.push("mark as a transfer");
  if (a.exclude) out.push("exclude from stats");
  return out;
}

/** "If payee contains “trader joe” → set category to Groceries, add tag weekly" */
export function describeRule(
  rule: Pick<Rule, "match" | "conditions" | "actions">,
  names: Names,
): { when: string; then: string } {
  const joiner = rule.match === "all" ? " and " : " or ";
  return {
    when: rule.conditions.map((c) => describeCondition(c, names)).join(joiner),
    then: describeActions(rule.actions, names).join(", "),
  };
}

/** A readable default name when the user leaves it blank. */
export function suggestRuleName(rule: Pick<Rule, "conditions" | "actions">, names: Names): string {
  const first = rule.conditions[0];
  const subject =
    first.field === "payee" || first.field === "description" ? String(first.value) : describeCondition(first, names);
  const category = rule.actions.categoryId !== undefined ? names.category(rule.actions.categoryId) : undefined;
  return category ? `${subject} → ${category}` : subject;
}
