import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { categories, rules as rulesTable, transactionTags, transactions } from "@/db/schema";
import { getTransactionRows } from "@/lib/finance/transactions-query";
import {
  applyRules,
  applyRulesToNew,
  createRule,
  deleteRule,
  getRule,
  listRules,
  previewRule,
  removeRulesForAccounts,
  reorderRules,
  RuleError,
  scrubCategoryFromRules,
  scrubTagFromRules,
  setRuleEnabled,
  updateRule,
} from "@/lib/rules/store";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const traderRule = (cat: number, extra: object = {}) => ({
  name: "Trader Joe's",
  conditions: [{ field: "payee" as const, op: "contains" as const, value: "trader joe" }],
  actions: { categoryId: cat, ...extra },
});

function setup() {
  const db = freshDb();
  addAccount(db, "chk");
  addAccount(db, "cc", { type: "credit" });
  const groceries = categoryId(db, "Groceries");
  const dining = categoryId(db, "Dining");
  const t = {
    tj1: addTxn(db, "chk", { description: "TRADER JOE'S #552 AUSTIN TX", amountCents: -4500, posted: 1_760_000_000 }),
    tj2: addTxn(db, "cc", {
      description: "TRADER JOES #12",
      payee: "Trader Joe's",
      amountCents: -2200,
      posted: 1_760_100_000,
    }),
    coffee: addTxn(db, "chk", {
      description: "SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA",
      amountCents: -550,
      posted: 1_760_200_000,
    }),
    pay: addTxn(db, "chk", { description: "ACME PAYROLL", amountCents: 300_000, posted: 1_760_300_000 }),
  };
  return { db, groceries, dining, t };
}

const get = (db: ReturnType<typeof freshDb>, id: number) =>
  db.select().from(transactions).where(eq(transactions.id, id)).get()!;

describe("rule CRUD", () => {
  it("creates rules at the end of the priority order and reads them back", () => {
    const { db, groceries, dining } = setup();
    const a = createRule(db, traderRule(groceries));
    const b = createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "coffee" }],
      actions: { categoryId: dining },
    });
    expect([a.priority, b.priority]).toEqual([0, 1]);
    expect(listRules(db).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(getRule(db, a.id)).toMatchObject({
      name: "Trader Joe's",
      match: "all",
      enabled: true,
      actions: { categoryId: groceries },
    });
    expect(getRule(db, 999)).toBeUndefined();
  });

  it("updates, enables/disables and deletes", () => {
    const { db, groceries, dining } = setup();
    const r = createRule(db, traderRule(groceries));
    const updated = updateRule(db, r.id, { ...traderRule(dining), name: "Renamed", match: "any", enabled: false });
    expect(updated).toMatchObject({ name: "Renamed", match: "any", enabled: false, actions: { categoryId: dining } });
    setRuleEnabled(db, r.id, true);
    expect(getRule(db, r.id)!.enabled).toBe(true);
    expect(() => updateRule(db, 999, traderRule(groceries))).toThrow(RuleError);
    expect(() => setRuleEnabled(db, 999, true)).toThrow(RuleError);
    expect(deleteRule(db, r.id)).toBe(true);
    expect(deleteRule(db, r.id)).toBe(false);
  });

  it("rejects rules that reference things that don't exist or are malformed", () => {
    const { db, groceries } = setup();
    expect(() => createRule(db, traderRule(9999))).toThrow(/category/);
    expect(() => createRule(db, traderRule(groceries, { addTagIds: [9999] }))).toThrow(/tags/);
    expect(() =>
      createRule(db, {
        conditions: [{ field: "account", op: "equals", value: "nope" }],
        actions: { categoryId: groceries },
      }),
    ).toThrow(/account/);
    expect(() => createRule(db, { conditions: [], actions: { categoryId: groceries } })).toThrow();
    expect(listRules(db)).toEqual([]);
  });

  it("reorders, requiring every rule exactly once", () => {
    const { db, groceries } = setup();
    const [a, b, c] = [1, 2, 3].map((n) => createRule(db, { ...traderRule(groceries), name: `r${n}` }));
    reorderRules(db, [c.id, a.id, b.id]);
    expect(listRules(db).map((r) => r.name)).toEqual(["r3", "r1", "r2"]);
    expect(() => reorderRules(db, [a.id, b.id])).toThrow(RuleError);
    expect(() => reorderRules(db, [a.id, a.id, b.id])).toThrow(RuleError);
    expect(() => reorderRules(db, [a.id, b.id, 999])).toThrow(RuleError);
  });

  it("skips rows that no longer validate instead of breaking everything", () => {
    const { db, groceries } = setup();
    const good = createRule(db, traderRule(groceries));
    db.insert(rulesTable).values({ name: "broken", priority: 5, conditionsJson: "not json", actionsJson: "{}" }).run();
    expect(listRules(db).map((r) => r.id)).toEqual([good.id]);
  });
});

describe("applyRules", () => {
  it("fills empty fields on all matching transactions and reports counts", () => {
    const { db, groceries, t } = setup();
    const tag = addTag(db, "weekly");
    createRule(db, traderRule(groceries, { addTagIds: [tag.id] }));
    const res = applyRules(db, { sample: 5 });
    expect(res).toMatchObject({ matched: 2, changed: 2 });
    expect(res.sampleIds).toEqual([t.tj2.id, t.tj1.id]); // most recent first
    expect(get(db, t.tj1.id).categoryId).toBe(groceries);
    expect(get(db, t.tj2.id).categoryId).toBe(groceries);
    expect(get(db, t.coffee.id).categoryId).toBeNull();
    expect(db.select().from(transactionTags).all()).toHaveLength(2);
  });

  it("is idempotent: a second run changes nothing", () => {
    const { db, groceries } = setup();
    createRule(db, traderRule(groceries));
    applyRules(db);
    expect(applyRules(db)).toMatchObject({ matched: 2, changed: 0 });
  });

  it("leaves user-set values alone unless overwrite is on", () => {
    const { db, groceries, dining, t } = setup();
    db.update(transactions).set({ categoryId: dining }).where(eq(transactions.id, t.tj1.id)).run();
    createRule(db, traderRule(groceries));
    expect(applyRules(db)).toMatchObject({ matched: 2, changed: 1 });
    expect(get(db, t.tj1.id).categoryId).toBe(dining);
    expect(applyRules(db, { overwrite: true })).toMatchObject({ matched: 2, changed: 1 });
    expect(get(db, t.tj1.id).categoryId).toBe(groceries);
  });

  it("honors priority: the first rule to set a field wins", () => {
    const { db, groceries, dining, t } = setup();
    const first = createRule(db, { ...traderRule(dining), name: "first" });
    createRule(db, { ...traderRule(groceries), name: "second" });
    applyRules(db);
    expect(get(db, t.tj1.id).categoryId).toBe(dining);
    reorderRules(db, [listRules(db)[1].id, first.id]);
    applyRules(db, { overwrite: true });
    expect(get(db, t.tj1.id).categoryId).toBe(groceries);
  });

  it("ignores disabled rules and can run a chosen subset", () => {
    const { db, groceries, dining, t } = setup();
    const off = createRule(db, { ...traderRule(groceries), enabled: false });
    expect(applyRules(db)).toMatchObject({ matched: 0, changed: 0 });
    const on = createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "blue bottle" }],
      actions: { categoryId: dining },
    });
    applyRules(db, { rules: [getRule(db, on.id)!] });
    expect(get(db, t.coffee.id).categoryId).toBe(dining);
    expect(get(db, t.tj1.id).categoryId).toBeNull();
    void off;
  });

  it("sets payee names, transfer and exclusion flags", () => {
    const { db, t } = setup();
    createRule(db, {
      conditions: [{ field: "description", op: "contains", value: "payroll" }],
      actions: { payeeOverride: "ACME", markTransfer: true, exclude: true },
    });
    applyRules(db);
    expect(get(db, t.pay.id)).toMatchObject({ payeeOverride: "ACME", isTransfer: true, isExcluded: true });
  });

  it("can be limited to specific ids (used for new imports)", () => {
    const { db, groceries, t } = setup();
    createRule(db, traderRule(groceries));
    expect(applyRulesToNew(db, [t.tj1.id])).toMatchObject({ matched: 1, changed: 1 });
    expect(get(db, t.tj2.id).categoryId).toBeNull();
    expect(applyRulesToNew(db, [])).toEqual({ matched: 0, changed: 0, sampleIds: [] });
  });

  it("matches on account, direction and amount conditions together", () => {
    const { db, dining, t } = setup();
    createRule(db, {
      match: "all",
      conditions: [
        { field: "account", op: "equals", value: "chk" },
        { field: "direction", op: "equals", value: "expense" },
        { field: "amount", op: "between", value: { min: 400, max: 1000 } },
      ],
      actions: { categoryId: dining },
    });
    applyRules(db);
    expect(get(db, t.coffee.id).categoryId).toBe(dining);
    for (const id of [t.tj1.id, t.tj2.id, t.pay.id]) expect(get(db, id).categoryId).toBeNull();
  });

  it("skips actions that point at rows deleted since the rule was saved", () => {
    const { db, groceries, t } = setup();
    createRule(db, traderRule(groceries));
    db.delete(categories).where(eq(categories.id, groceries)).run();
    expect(() => applyRules(db)).not.toThrow();
    expect(get(db, t.tj1.id).categoryId).toBeNull();
  });
});

describe("previewRule", () => {
  it("counts matches and would-change accurately without writing anything", () => {
    const { db, groceries, dining, t } = setup();
    db.update(transactions).set({ categoryId: dining }).where(eq(transactions.id, t.tj1.id)).run();
    const before = db.select().from(transactions).all();
    const fill = previewRule(db, traderRule(groceries));
    expect(fill).toMatchObject({ matched: 2, changed: 1 });
    expect(fill.sampleIds).toEqual([t.tj2.id, t.tj1.id]);
    expect(previewRule(db, traderRule(groceries), { overwrite: true })).toMatchObject({ matched: 2, changed: 2 });
    expect(db.select().from(transactions).all()).toEqual(before);
  });

  it("agrees with what applying would do, and sample rows load in order", () => {
    const { db, groceries } = setup();
    const draft = traderRule(groceries);
    const preview = previewRule(db, draft, { sample: 1 });
    expect(preview.sampleIds).toHaveLength(1);
    expect(getTransactionRows(db, preview.sampleIds)[0].description).toContain("TRADER JOES");
    createRule(db, draft);
    expect(applyRules(db)).toMatchObject({ matched: preview.matched, changed: preview.changed });
  });

  it("validates the draft", () => {
    const { db } = setup();
    expect(() =>
      previewRule(db, { conditions: [{ field: "description", op: "regex", value: "(" }], actions: { exclude: true } }),
    ).toThrow();
  });
});

describe("keeping rules consistent", () => {
  it("rewrites a merged category and drops a deleted one, removing rules left empty", () => {
    const { db, groceries, dining } = setup();
    const tag = addTag(db, "t");
    const onlyCategory = createRule(db, traderRule(groceries));
    const both = createRule(db, traderRule(groceries, { addTagIds: [tag.id] }));
    expect(scrubCategoryFromRules(db, groceries, dining)).toEqual({ rewritten: 2, removed: 0 });
    expect(getRule(db, onlyCategory.id)!.actions.categoryId).toBe(dining);
    expect(scrubCategoryFromRules(db, dining, null)).toEqual({ rewritten: 1, removed: 1 });
    expect(getRule(db, onlyCategory.id)).toBeUndefined();
    expect(getRule(db, both.id)!.actions).toEqual({ addTagIds: [tag.id] });
  });

  it("removes a deleted tag from rules", () => {
    const { db, groceries } = setup();
    const [a, b] = [addTag(db, "a"), addTag(db, "b")];
    const r = createRule(db, traderRule(groceries, { addTagIds: [a.id, b.id] }));
    expect(scrubTagFromRules(db, a.id)).toEqual({ rewritten: 1, removed: 0 });
    expect(getRule(db, r.id)!.actions.addTagIds).toEqual([b.id]);
    const tagOnly = createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "x" }],
      actions: { addTagIds: [a.id] },
    });
    expect(scrubTagFromRules(db, a.id)).toEqual({ rewritten: 0, removed: 1 });
    expect(getRule(db, tagOnly.id)).toBeUndefined();
  });

  it("removes rules that compare against a removed account", () => {
    const { db, groceries } = setup();
    createRule(db, {
      conditions: [{ field: "account", op: "equals", value: "cc" }],
      actions: { categoryId: groceries },
    });
    const keep = createRule(db, traderRule(groceries));
    expect(removeRulesForAccounts(db, ["cc"])).toBe(1);
    expect(listRules(db).map((r) => r.id)).toEqual([keep.id]);
  });
});

describe("performance", () => {
  it("evaluates 20 rules against 10,000 transactions quickly", () => {
    const db = freshDb();
    addAccount(db, "a");
    const cat = categoryId(db, "Shopping");
    db.transaction((tx) => {
      for (let i = 0; i < 10_000; i++)
        addTxn(tx as never, "a", { description: `MERCHANT ${i % 200} #${i}`, amountCents: -(i % 900) - 100 });
    });
    for (let i = 0; i < 20; i++)
      createRule(db, {
        name: `r${i}`,
        conditions: [{ field: "payee", op: "contains", value: `merchant ${i * 7}` }],
        actions: { categoryId: cat },
      });
    const t0 = performance.now();
    const res = previewRule(db, {
      conditions: [{ field: "description", op: "regex", value: "MERCHANT 1\\d\\d " }],
      actions: { categoryId: cat },
    });
    const all = applyRules(db, { dryRun: true });
    const ms = performance.now() - t0;
    expect(res.matched).toBeGreaterThan(0);
    expect(all.matched).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1500);
  });
});
