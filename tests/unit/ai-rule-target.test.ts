import { describe, expect, it } from "vitest";
import { candidateRule, choosePattern, findExtendableRule, newRuleName, previewProposal } from "@/lib/ai/rule-target";
import type { RuleAction } from "@/lib/ai/proposal-types";
import type { PayeeGroup } from "@/lib/llm/categorize";
import { createRule, listRules } from "@/lib/rules/store";
import type { Rule } from "@/lib/rules/types";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";
import { payload } from "../helpers/ai";

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 1,
  name: "r",
  priority: 0,
  enabled: true,
  match: "any",
  conditions: [{ field: "payee", op: "equals", value: "Starbucks" }],
  actions: { categoryId: 1 },
  ...over,
});
const dining: RuleAction = { type: "category", categoryId: 1, categoryName: "Dining" };

describe("findExtendableRule", () => {
  it("accepts the owner's own any/payee-only/category-only rule", () => {
    expect(findExtendableRule([rule()], dining)?.id).toBe(1);
  });

  it("ignores rules that can't safely take another condition", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      field: "payee" as const,
      op: "equals" as const,
      value: `m${i}`,
    }));
    for (const r of [
      rule({ actions: { categoryId: 1, addTagIds: [2] } }),
      rule({ match: "all" }),
      rule({ conditions: [{ field: "description", op: "contains", value: "x" }] }),
      rule({ conditions: [{ field: "payee", op: "regex", value: "x" }] }),
      rule({ enabled: false }),
      rule({ conditions: many }),
      rule({ actions: { categoryId: 2 } }),
    ])
      expect(findExtendableRule([r], dining)).toBeNull();
  });

  it("extends tag rules only for exactly that tag", () => {
    const tagRule = rule({ actions: { addTagIds: [7] } });
    expect(findExtendableRule([tagRule], { type: "tag", tagId: 7, tagName: "Subs" })?.id).toBe(1);
    expect(findExtendableRule([tagRule], { type: "tag", tagId: 8, tagName: "X" })).toBeNull();
  });
});

describe("naming and candidates", () => {
  it("numbers names that are taken", () => {
    expect(newRuleName([], "Dining")).toBe("AI · Dining");
    expect(newRuleName([rule({ name: "AI · Dining" })], "Dining")).toBe("AI · Dining 2");
    expect(newRuleName([rule({ name: "AI · Dining" }), rule({ name: "AI · Dining 2" })], "Dining")).toBe(
      "AI · Dining 3",
    );
  });

  it("builds a new rule at the end, or extends without mutating", () => {
    const existing = rule({ priority: 4, actions: { categoryId: 9 } });
    const fresh = candidateRule([existing], payload());
    expect(fresh.mode).toBe("new");
    expect(fresh.rule).toMatchObject({ name: "AI · Dining", priority: 5, match: "any", actions: { categoryId: 1 } });

    const ext = rule();
    const extended = candidateRule([ext], payload());
    expect(extended.mode).toBe("extend");
    expect(extended.rule.conditions).toHaveLength(2);
    expect(ext.conditions).toHaveLength(1);
  });

  it("doesn't add the same condition twice", () => {
    const ext = rule({ conditions: [{ field: "payee", op: "equals", value: "Blue Bottle Coffee" }] });
    expect(candidateRule([ext], payload()).rule.conditions).toHaveLength(1);
  });
});

describe("preview and pattern choice", () => {
  function setup() {
    const db = freshDb();
    addAccount(db, "a1");
    return {
      db,
      dining: categoryId(db, "Dining"),
      groceries: categoryId(db, "Groceries"),
      transport: categoryId(db, "Transport"),
    };
  }
  const act = (id: number, name: string): RuleAction => ({ type: "category", categoryId: id, categoryName: name });
  const pay = (name: string, action: RuleAction) => ({
    ...payload(name),
    action,
    pattern: { op: "equals" as const, value: name },
  });

  it("counts matches, fillable rows and conflicts", () => {
    const { db, dining, groceries } = setup();
    for (let i = 1; i <= 3; i++) addTxn(db, "a1", { description: `SQ *BLUE BOTTLE COFFEE #${i}` });
    addTxn(db, "a1", { description: "BLUE BOTTLE COFFEE", categoryId: dining });
    expect(previewProposal(db, pay("Blue Bottle Coffee", act(dining, "Dining")), "UTC")).toMatchObject({
      matched: 4,
      wouldChange: 3,
      conflicts: 0,
    });
    addTxn(db, "a1", { description: "BLUE BOTTLE COFFEE", categoryId: groceries });
    const p = previewProposal(db, pay("Blue Bottle Coffee", act(dining, "Dining")), "UTC");
    expect(p.conflicts).toBe(1);
    expect(p.conflictSamples[0]).toMatchObject({ category: "Groceries" });
  });

  it("falls back to equals when contains would conflict or is too short", () => {
    const { db, transport, dining } = setup();
    addTxn(db, "a1", { description: "UBER TRIP", amountCents: -1500 });
    addTxn(db, "a1", { description: "UBER EATS ORDER", categoryId: dining });
    const group: Pick<PayeeGroup, "payee"> = { payee: "Uber" };
    const a = choosePattern(db, group, act(transport, "Transport"), "UBER", "UTC");
    expect(a.pattern).toEqual({ op: "equals", value: "Uber" });
    const b = choosePattern(db, group, act(transport, "Transport"), "UBE", "UTC");
    expect(b.pattern.op).toBe("equals");
    const c = choosePattern(db, { payee: "Netflix" }, act(dining, "Dining"), "NETFLIX", "UTC");
    expect(c.pattern).toEqual({ op: "contains", value: "NETFLIX" });
  });

  it("works against saved rules too", () => {
    const { db, dining } = setup();
    createRule(db, {
      name: "mine",
      match: "any",
      conditions: [{ field: "payee", op: "equals", value: "X" }],
      actions: { categoryId: dining },
    });
    expect(findExtendableRule(listRules(db), act(dining, "Dining"))?.name).toBe("mine");
  });
});
