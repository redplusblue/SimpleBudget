import { describe, expect, it } from "vitest";
import { insertProposals, listProposals } from "@/lib/ai/proposals";
import { parseRuleResponse, planSuggestions, suggestRules } from "@/lib/ai/rule-suggestions";
import { collectUncategorized, listCategoryChoices } from "@/lib/llm/categorize";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { createRule } from "@/lib/rules/store";
import { accounts } from "@/db/schema";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";
import { payload } from "../helpers/ai";

function setup() {
  const db = freshDb();
  addAccount(db, "a1");
  for (let i = 1; i <= 3; i++) addTxn(db, "a1", { description: `SQ *BLUE BOTTLE COFFEE #${i}`, amountCents: -500 });
  for (let i = 1; i <= 2; i++) addTxn(db, "a1", { description: `CHIPOTLE #${i}`, amountCents: -1200 });
  addTxn(db, "a1", { description: "WHOLE FOODS", amountCents: -4000 });
  return db;
}

const indexOf = (db: ReturnType<typeof freshDb>, payee: RegExp) =>
  collectUncategorized(db).find((g) => payee.test(g.payee) || payee.test(g.sample))!.index;

function fake(answer: (req: GenerateRequest) => string) {
  const requests: GenerateRequest[] = [];
  const llm: LlmClient = {
    async generate(req) {
      requests.push(req);
      return answer(req);
    },
  };
  return { llm, requests };
}
const env = (db: ReturnType<typeof freshDb>, llm: LlmClient) => ({ db, llm, model: "m", now: 5000, timeZone: "UTC" });

describe("suggestRules", () => {
  it("creates pending proposals; same-category merchants target the same rule", async () => {
    const db = setup();
    const { llm } = fake((req) => {
      // Numbers in the prompt are the (re-indexed) positions.
      const num = (name: string) => Number(new RegExp(`(\\d+)\\. ${name}`, "i").exec(req.user)![1]);
      return JSON.stringify([
        { i: num("Blue Bottle"), category: "Dining", confidence: "high", contains: "BLUE BOTTLE" },
        { i: num("Chipotle"), category: "Dining", confidence: "medium" },
        { i: num("Whole Foods"), category: "Groceries", confidence: "low" },
      ]);
    });
    const r = await suggestRules(env(db, llm), { maxMerchants: 100 });
    expect(r).toMatchObject({ created: 3, noMatch: 0, unanswered: 0, calls: 1, deferred: 0 });
    const list = listProposals(db, { status: "pending" });
    const by = (n: string) => list.find((p) => p.payload.merchant.name.toLowerCase().includes(n))!;
    expect(by("blue bottle").payload.pattern).toEqual({ op: "contains", value: "BLUE BOTTLE" });
    expect(by("blue bottle").row.confidence).toBe("high");
    expect(by("chipotle").payload.pattern.op).toBe("equals");
    expect(by("blue bottle").payload.target.mode).toBe("new");
    expect(by("chipotle").payload.target.mode).toBe("extend");
    expect(by("chipotle").payload.target).toMatchObject({ ruleName: "AI · Dining" });
    expect(by("whole foods").payload.target).toMatchObject({ mode: "new", ruleName: "AI · Groceries" });
    expect(by("blue bottle").preview).toMatchObject({ matched: 3, wouldChange: 3 });
  });

  it("stores no_match for unanswered merchants in a valid response, nothing for garbage", async () => {
    const db = setup();
    const a = fake(() => JSON.stringify([{ i: indexOf(db, /blue bottle/i), category: "Dining", confidence: "high" }]));
    const r = await suggestRules(env(db, a.llm), { maxMerchants: 100 });
    expect(r).toMatchObject({ created: 1, noMatch: 2 });
    expect(listProposals(db, { status: "no_match" })).toHaveLength(2);

    const db2 = setup();
    const g = fake(() => "I cannot help with that");
    const r2 = await suggestRules(env(db2, g.llm), { maxMerchants: 100 });
    expect(r2).toMatchObject({ created: 0, noMatch: 0, unanswered: 3 });
    expect(listProposals(db2, { status: ["pending", "no_match"] })).toHaveLength(0);
  });

  it("skips merchants already asked about or covered by a rule", async () => {
    const db = setup();
    createRule(db, {
      name: "mine",
      match: "any",
      conditions: [{ field: "payee", op: "equals", value: "Chipotle" }],
      actions: { categoryId: categoryId(db, "Dining") },
    });
    insertProposals(db, [
      {
        kind: "rule",
        source: "rules_job",
        subjectKey: "category:expense:wholefoods",
        status: "dismissed",
        payloadJson: JSON.stringify(payload("Whole Foods")),
        createdAt: 1,
      },
    ]);
    const plan = planSuggestions(db, { maxMerchants: 100 });
    expect(plan.groups.map((g) => g.payee.toLowerCase())).toEqual(["blue bottle coffee"]);
    const { llm, requests } = fake(() => "[]");
    await suggestRules(env(db, llm), { maxMerchants: 100 });
    expect(requests[0].user).not.toMatch(/Chipotle|Whole Foods/i);
  });

  it("respects maxMerchants and plans cost only when prices are known", () => {
    const db = setup();
    const plan = planSuggestions(db, { maxMerchants: 2, entry: { id: "m", inputPerMTok: 1, outputPerMTok: 2 } });
    expect(plan).toMatchObject({ eligible: 3, toSend: 2, calls: 1 });
    expect(plan.estimatedCostMicros).toBeGreaterThan(0);
    expect(planSuggestions(db, { maxMerchants: 2 }).estimatedCostMicros).toBeNull();
  });

  it("reports deferred merchants", async () => {
    const db = setup();
    const { llm } = fake(() => "[]");
    expect(await suggestRules(env(db, llm), { maxMerchants: 1 })).toMatchObject({ deferred: 2, calls: 1 });
  });

  it("sends no account ids, memos or notes", async () => {
    const db = setup();
    db.update(accounts).set({ name: "SECRET-ACCOUNT-NAME" }).run();
    addTxn(db, "a1", { description: "CORNER SHOP", memo: "SECRET-MEMO", note: "SECRET-NOTE" } as never);
    const { llm, requests } = fake(() => "[]");
    await suggestRules(env(db, llm), { maxMerchants: 100 });
    const wire = JSON.stringify(requests);
    for (const s of ['a1"', "SECRET-MEMO", "SECRET-NOTE", "SECRET-ACCOUNT-NAME"]) expect(wire).not.toContain(s);
  });
});

describe("parseRuleResponse", () => {
  it("keeps valid contains text only", () => {
    const db = setup();
    const groups = collectUncategorized(db);
    const choices = listCategoryChoices(db);
    const text = JSON.stringify([
      { i: 0, category: "Dining", confidence: "high", contains: "abc" },
      { i: 1, category: "dining", confidence: "low", contains: "CHIPOTLE" },
      { i: 1, category: "Dining", confidence: "low" },
      { i: 2, category: "Nope", confidence: "low" },
    ]);
    const { answers, parsed } = parseRuleResponse(text, groups, choices);
    expect(parsed).toBe(true);
    expect(answers.map((a) => [a.group.index, a.contains])).toEqual([
      [0, undefined],
      [1, "CHIPOTLE"],
    ]);
  });
});
