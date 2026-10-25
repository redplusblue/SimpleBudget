import { describe, expect, it } from "vitest";
import {
  changeField,
  draftToInput,
  emptyDraft,
  newCondition,
  ruleToDraft,
  type RuleDraft,
} from "@/components/rules/draft";
import {
  describeActions,
  describeCondition,
  describeRule,
  suggestRuleName,
  type Names,
} from "@/components/rules/describe";
import type { Rule } from "@/lib/rules/types";

const names: Names = {
  account: (id) => ({ chk: "Total Checking" })[id],
  category: (id) => ({ 1: "Groceries", 2: "Dining" })[id],
  tag: (id) => ({ 7: "weekly" })[id],
};

const draft = (over: Partial<RuleDraft> = {}): RuleDraft => ({
  ...emptyDraft(),
  conditions: [{ ...newCondition("payee"), op: "contains", text: "trader joe" }],
  categoryId: 1,
  ...over,
});

describe("draftToInput", () => {
  it("builds a valid rule from a complete draft", () => {
    const r = draftToInput(draft({ tagIds: [7], payeeOverride: " TJ ", markTransfer: false }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toMatchObject({
        match: "all",
        conditions: [{ field: "payee", op: "contains", value: "trader joe" }],
        actions: { categoryId: 1, addTagIds: [7], payeeOverride: "TJ" },
      });
    }
  });

  it("converts dollar amounts to cents, including between", () => {
    const gt = draftToInput(draft({ conditions: [{ ...newCondition("amount"), op: "gt", text: "$25.50" }] }));
    expect(gt.ok && gt.input.conditions[0]).toEqual({ field: "amount", op: "gt", value: 2550 });
    const between = draftToInput(
      draft({ conditions: [{ ...newCondition("amount"), op: "between", min: "5", max: "20.5" }] }),
    );
    expect(between.ok && between.input.conditions[0]).toEqual({
      field: "amount",
      op: "between",
      value: { min: 500, max: 2050 },
    });
    // negative input is treated as a size
    const neg = draftToInput(draft({ conditions: [{ ...newCondition("amount"), op: "lt", text: "-10" }] }));
    expect(neg.ok && neg.input.conditions[0]).toEqual({ field: "amount", op: "lt", value: 1000 });
  });

  it.each([
    ["a blank value", { conditions: [{ ...newCondition("payee"), text: "  " }] }, /value/i],
    ["no conditions", { conditions: [] }, /condition/i],
    ["an unreadable amount", { conditions: [{ ...newCondition("amount"), op: "gt", text: "abc" }] }, /25\.00/],
    ["a missing amount", { conditions: [{ ...newCondition("amount"), op: "gt", text: "" }] }, /amount/i],
    ["half a range", { conditions: [{ ...newCondition("amount"), op: "between", min: "5", max: "" }] }, /both/i],
    [
      "an inverted range",
      { conditions: [{ ...newCondition("amount"), op: "between", min: "50", max: "5" }] },
      /minimum/i,
    ],
    [
      "an invalid regex",
      { conditions: [{ ...newCondition("description"), op: "regex", text: "(" }] },
      /regular expression/i,
    ],
    ["no actions", { categoryId: null }, /action/i],
  ])("rejects %s", (_label, over, message) => {
    const r = draftToInput(draft(over as Partial<RuleDraft>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("supports direction and account conditions", () => {
    const r = draftToInput(
      draft({
        match: "any",
        conditions: [
          { ...changeField(newCondition(), "direction"), text: "income" },
          { ...changeField(newCondition(), "account"), text: "chk" },
        ],
      }),
    );
    expect(r.ok && r.input.conditions).toEqual([
      { field: "direction", op: "equals", value: "income" },
      { field: "account", op: "equals", value: "chk" },
    ]);
  });
});

describe("changeField", () => {
  it("resets the operator and values, defaulting direction to expense", () => {
    const c = { ...newCondition("amount"), op: "between", min: "1", max: "2", text: "3" };
    expect(changeField(c, "payee")).toMatchObject({ field: "payee", op: "contains", text: "", min: "", max: "" });
    expect(changeField(c, "direction")).toMatchObject({ field: "direction", op: "equals", text: "expense" });
    expect(changeField(c, "amount")).toMatchObject({ op: "gt" });
  });
});

describe("ruleToDraft round-trips", () => {
  const rule: Rule = {
    id: 3,
    priority: 0,
    name: "Big shop",
    enabled: false,
    match: "any",
    conditions: [
      { field: "payee", op: "contains", value: "trader" },
      { field: "amount", op: "between", value: { min: 500, max: 2050 } },
      { field: "amount", op: "gt", value: 12_345 },
      { field: "direction", op: "equals", value: "expense" },
    ],
    actions: { categoryId: 1, addTagIds: [7], payeeOverride: "TJ", markTransfer: true, exclude: true },
  };
  it("restores the editable form and converts back to an identical rule", () => {
    const d = ruleToDraft(rule);
    expect(d).toMatchObject({
      name: "Big shop",
      match: "any",
      enabled: false,
      categoryId: 1,
      tagIds: [7],
      payeeOverride: "TJ",
      markTransfer: true,
      exclude: true,
    });
    expect(d.conditions[1]).toMatchObject({ min: "5.00", max: "20.50" });
    expect(d.conditions[2].text).toBe("123.45");
    const back = draftToInput(d);
    expect(back.ok && { conditions: back.input.conditions, actions: back.input.actions }).toEqual({
      conditions: rule.conditions,
      actions: rule.actions,
    });
  });
});

describe("descriptions", () => {
  it("describe conditions in plain language", () => {
    expect(describeCondition({ field: "payee", op: "contains", value: "trader" }, names)).toBe(
      "payee contains “trader”",
    );
    expect(describeCondition({ field: "amount", op: "between", value: { min: 500, max: 2000 } }, names)).toBe(
      "amount is between $5.00 and $20.00",
    );
    expect(describeCondition({ field: "amount", op: "gt", value: 10_000 }, names)).toBe("amount is more than $100.00");
    expect(describeCondition({ field: "account", op: "equals", value: "chk" }, names)).toBe(
      "account is Total Checking",
    );
    expect(describeCondition({ field: "account", op: "equals", value: "gone" }, names)).toBe(
      "account is a removed account",
    );
    expect(describeCondition({ field: "direction", op: "equals", value: "income" }, names)).toBe("money comes in");
  });
  it("describe actions and whole rules", () => {
    expect(
      describeActions(
        { categoryId: 1, addTagIds: [7, 99], payeeOverride: "TJ", markTransfer: true, exclude: true },
        names,
      ),
    ).toEqual([
      "set category to Groceries",
      "add tag weekly",
      "add tag a removed tag",
      "rename payee to “TJ”",
      "mark as a transfer",
      "exclude from stats",
    ]);
    const d = describeRule(
      {
        match: "any",
        conditions: [
          { field: "payee", op: "contains", value: "a" },
          { field: "direction", op: "equals", value: "expense" },
        ],
        actions: { categoryId: 2 },
      },
      names,
    );
    expect(d).toEqual({ when: "payee contains “a” or money goes out", then: "set category to Dining" });
  });
  it("suggests a name", () => {
    expect(
      suggestRuleName(
        { conditions: [{ field: "payee", op: "contains", value: "Trader Joe's" }], actions: { categoryId: 1 } },
        names,
      ),
    ).toBe("Trader Joe's → Groceries");
    expect(
      suggestRuleName({ conditions: [{ field: "amount", op: "gt", value: 5000 }], actions: { exclude: true } }, names),
    ).toBe("amount is more than $50.00");
  });
});
