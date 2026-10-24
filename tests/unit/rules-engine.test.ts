import { describe, expect, it } from "vitest";
import {
  conditionMatches,
  planChangesTarget,
  planForTransaction,
  ruleMatches,
  rulePayee,
  type RuleTarget,
} from "@/lib/rules/engine";
import { actionsSchema, conditionSchema, ruleInputSchema, type Condition, type Rule } from "@/lib/rules/types";

const txn = (over: Partial<RuleTarget> = {}): RuleTarget => ({
  id: 1,
  accountId: "chk",
  description: "TRADER JOE'S #552 AUSTIN TX",
  payee: null,
  payeeOverride: null,
  amountCents: -8745,
  categoryId: null,
  isTransfer: false,
  isExcluded: false,
  tagIds: [],
  ...over,
});

const rule = (id: number, conditions: Condition[], actions: Rule["actions"], match: Rule["match"] = "all"): Rule => ({
  id,
  priority: id,
  name: `r${id}`,
  enabled: true,
  match,
  conditions,
  actions,
});

describe("conditions", () => {
  it("description: contains / equals are case-insensitive, regex works", () => {
    expect(conditionMatches({ field: "description", op: "contains", value: "trader joe" }, txn())).toBe(true);
    expect(conditionMatches({ field: "description", op: "contains", value: "whole foods" }, txn())).toBe(false);
    expect(conditionMatches({ field: "description", op: "equals", value: "trader joe's #552 austin tx" }, txn())).toBe(
      true,
    );
    expect(conditionMatches({ field: "description", op: "equals", value: "trader joe" }, txn())).toBe(false);
    expect(conditionMatches({ field: "description", op: "regex", value: "#\\d{3}\\b" }, txn())).toBe(true);
    expect(conditionMatches({ field: "description", op: "regex", value: "^AUSTIN" }, txn())).toBe(false);
  });

  it("payee matches the cleaned-up name, ignoring case and punctuation", () => {
    expect(conditionMatches({ field: "payee", op: "contains", value: "Trader Joes" }, txn())).toBe(true);
    expect(conditionMatches({ field: "payee", op: "equals", value: "TRADER JOE'S" }, txn())).toBe(true);
    expect(conditionMatches({ field: "payee", op: "equals", value: "Trader" }, txn())).toBe(false);
    expect(conditionMatches({ field: "payee", op: "regex", value: "^trader joe's$" }, txn())).toBe(true);
    // store number and city are gone from what the rule sees
    expect(conditionMatches({ field: "payee", op: "contains", value: "austin" }, txn())).toBe(false);
    expect(conditionMatches({ field: "payee", op: "contains", value: "552" }, txn())).toBe(false);
  });

  it("payee prefers the user's override, then the bank payee, then the description", () => {
    expect(rulePayee(txn({ payeeOverride: "My Grocer", payee: "TJ" }))).toBe("My Grocer");
    expect(rulePayee(txn({ payee: "Trader Joe's" }))).toBe("Trader Joe's");
    expect(rulePayee(txn())).toBe("TRADER JOE'S");
    expect(
      conditionMatches({ field: "payee", op: "contains", value: "my grocer" }, txn({ payeeOverride: "My Grocer" })),
    ).toBe(true);
  });

  it("amount compares size, with inclusive between", () => {
    const t = txn({ amountCents: -5000 });
    expect(conditionMatches({ field: "amount", op: "gt", value: 4999 }, t)).toBe(true);
    expect(conditionMatches({ field: "amount", op: "gt", value: 5000 }, t)).toBe(false);
    expect(conditionMatches({ field: "amount", op: "lt", value: 5001 }, t)).toBe(true);
    expect(conditionMatches({ field: "amount", op: "equals", value: 5000 }, t)).toBe(true);
    expect(conditionMatches({ field: "amount", op: "between", value: { min: 5000, max: 6000 } }, t)).toBe(true);
    expect(conditionMatches({ field: "amount", op: "between", value: { min: 5001, max: 6000 } }, t)).toBe(false);
    expect(conditionMatches({ field: "amount", op: "gt", value: 4000 }, txn({ amountCents: 5000 }))).toBe(true); // income too
  });

  it("account and direction", () => {
    expect(conditionMatches({ field: "account", op: "equals", value: "chk" }, txn())).toBe(true);
    expect(conditionMatches({ field: "account", op: "equals", value: "cc" }, txn())).toBe(false);
    expect(conditionMatches({ field: "direction", op: "equals", value: "expense" }, txn())).toBe(true);
    expect(conditionMatches({ field: "direction", op: "equals", value: "income" }, txn())).toBe(false);
    expect(conditionMatches({ field: "direction", op: "equals", value: "income" }, txn({ amountCents: 100 }))).toBe(
      true,
    );
    expect(conditionMatches({ field: "direction", op: "equals", value: "expense" }, txn({ amountCents: 0 }))).toBe(
      false,
    );
  });
});

describe("ruleMatches", () => {
  const c1: Condition = { field: "payee", op: "contains", value: "trader" };
  const c2: Condition = { field: "amount", op: "gt", value: 100_000 };
  it("all vs any", () => {
    expect(ruleMatches({ match: "all", conditions: [c1, c2] }, txn())).toBe(false);
    expect(ruleMatches({ match: "any", conditions: [c1, c2] }, txn())).toBe(true);
    expect(ruleMatches({ match: "all", conditions: [c1] }, txn())).toBe(true);
  });
  it("never matches without conditions", () => {
    expect(ruleMatches({ match: "all", conditions: [] }, txn())).toBe(false);
    expect(ruleMatches({ match: "any", conditions: [] }, txn())).toBe(false);
  });
});

describe("planForTransaction", () => {
  const groceries = rule(1, [{ field: "payee", op: "contains", value: "trader" }], { categoryId: 10, addTagIds: [1] });
  const shopping = rule(2, [{ field: "amount", op: "gt", value: 1000 }], {
    categoryId: 20,
    addTagIds: [2],
    payeeOverride: "Big Spender",
  });

  it("returns null when nothing matches", () => {
    expect(planForTransaction([groceries], txn({ description: "SHELL OIL" }))).toBeNull();
    expect(planForTransaction([], txn())).toBeNull();
  });

  it("the first matching rule decides each field; later rules can't change it", () => {
    const plan = planForTransaction([groceries, shopping], txn())!;
    expect(plan.categoryId).toBe(10);
    expect(plan.payeeOverride).toBe("Big Spender"); // a field the first rule left alone is still available
    expect(plan.matched).toEqual([1, 2]);
    expect(planForTransaction([shopping, groceries], txn())!.categoryId).toBe(20); // order is priority
  });

  it("tags accumulate across rules without duplicates", () => {
    const again = rule(3, [{ field: "payee", op: "contains", value: "trader" }], { addTagIds: [1, 3] });
    expect(planForTransaction([groceries, shopping, again], txn())!.addTagIds).toEqual([1, 2, 3]);
  });

  it("fills only empty fields by default and overwrites on request", () => {
    // Match on the description so the user's payee override doesn't change what the rules see.
    const byDescription = rule(1, [{ field: "description", op: "contains", value: "trader joe" }], {
      categoryId: 10,
      addTagIds: [1],
    });
    const t = txn({ categoryId: 99, payeeOverride: "Mine" });
    const fill = planForTransaction([byDescription, shopping], t)!;
    expect(fill.categoryId).toBeUndefined();
    expect(fill.payeeOverride).toBeUndefined();
    expect(fill.addTagIds).toEqual([1, 2]);
    const over = planForTransaction([byDescription, shopping], t, { overwrite: true })!;
    expect(over.categoryId).toBe(10);
    expect(over.payeeOverride).toBe("Big Spender");
  });

  it("rules see the payee override, not the original description, when matching on payee", () => {
    expect(planForTransaction([groceries], txn({ payeeOverride: "Mine" }))).toBeNull();
  });

  it("an earlier rule's value wins even when overwriting", () => {
    expect(planForTransaction([groceries, shopping], txn({ categoryId: 99 }), { overwrite: true })!.categoryId).toBe(
      10,
    );
  });

  it("transfer and exclude flags only ever turn on", () => {
    const r = rule(4, [{ field: "payee", op: "contains", value: "trader" }], { markTransfer: true, exclude: true });
    expect(planForTransaction([r], txn())).toMatchObject({ markTransfer: true, exclude: true });
    const already = planForTransaction([r], txn({ isTransfer: true, isExcluded: true }))!;
    expect(already.markTransfer).toBeUndefined();
    expect(already.exclude).toBeUndefined();
  });
});

describe("planChangesTarget", () => {
  const r = rule(1, [{ field: "payee", op: "contains", value: "trader" }], { categoryId: 10, addTagIds: [1] });
  it("detects real changes and no-ops", () => {
    expect(planChangesTarget(planForTransaction([r], txn()), txn())).toBe(true);
    const done = txn({ categoryId: 10, tagIds: [1] });
    expect(planChangesTarget(planForTransaction([r], done, { overwrite: true }), done)).toBe(false);
    expect(planChangesTarget(null, txn())).toBe(false);
    const missingTag = txn({ categoryId: 10, tagIds: [] });
    expect(planChangesTarget(planForTransaction([r], missingTag, { overwrite: true }), missingTag)).toBe(true);
  });
});

describe("schemas", () => {
  it("accept valid rules and fill defaults", () => {
    const parsed = ruleInputSchema.parse({
      conditions: [{ field: "payee", op: "contains", value: " Trader " }],
      actions: { categoryId: 3 },
    });
    expect(parsed).toMatchObject({ name: "", match: "all", enabled: true });
    expect(parsed.conditions[0]).toMatchObject({ value: "Trader" }); // trimmed
  });
  it("reject bad regex, empty values, inverted ranges and empty actions", () => {
    expect(conditionSchema.safeParse({ field: "description", op: "regex", value: "(" }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "description", op: "regex", value: "x".repeat(201) }).success).toBe(
      false,
    );
    expect(conditionSchema.safeParse({ field: "payee", op: "contains", value: "  " }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "amount", op: "between", value: { min: 500, max: 100 } }).success).toBe(
      false,
    );
    expect(conditionSchema.safeParse({ field: "amount", op: "gt", value: -1 }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "amount", op: "contains", value: 5 }).success).toBe(false);
    expect(conditionSchema.safeParse({ field: "direction", op: "equals", value: "sideways" }).success).toBe(false);
    expect(actionsSchema.safeParse({}).success).toBe(false);
    expect(actionsSchema.safeParse({ addTagIds: [] }).success).toBe(false);
    expect(actionsSchema.safeParse({ markTransfer: false }).success).toBe(false);
    expect(actionsSchema.safeParse({ exclude: true }).success).toBe(true);
    expect(actionsSchema.safeParse({ categoryId: 1, bogus: true }).success).toBe(false);
    expect(ruleInputSchema.safeParse({ conditions: [], actions: { categoryId: 1 } }).success).toBe(false);
  });
});
