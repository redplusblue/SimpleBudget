import { describe, expect, it } from "vitest";
import { transactions, transactionSplits } from "@/db/schema";
import {
  applyProposals,
  collectUncategorized,
  listCategoryChoices,
  parseBatchResponse,
  proposeCategories,
} from "@/lib/llm/categorize";
import { listRules } from "@/lib/rules/store";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

function setup() {
  const db = freshDb();
  addAccount(db, "a1");
  const coffee = (n: number) => addTxn(db, "a1", { description: `SQ *BLUE BOTTLE COFFEE #${n}`, amountCents: -500 });
  const ids = [coffee(1), coffee(2), coffee(3)].map((t) => t.id);
  const refund = addTxn(db, "a1", { description: "BLUE BOTTLE REFUND", payee: "Blue Bottle Coffee", amountCents: 500 });
  const pay = addTxn(db, "a1", { description: "ACME PAYROLL", amountCents: 200_000 });
  return { db, ids, refund, pay };
}

describe("collectUncategorized", () => {
  it("groups by merchant and direction, biggest first, skipping categorized/transfer/excluded/split rows", () => {
    const { db, ids } = setup();
    addTxn(db, "a1", { description: "DONE", categoryId: categoryId(db, "Dining") });
    addTxn(db, "a1", { description: "XFER", isTransfer: true });
    addTxn(db, "a1", { description: "HIDDEN", isExcluded: true });
    const split = addTxn(db, "a1", { description: "SPLIT STORE" });
    db.insert(transactionSplits)
      .values({ transactionId: split.id, categoryId: categoryId(db, "Dining"), amountCents: -1000 })
      .run();

    const groups = collectUncategorized(db);
    expect(groups[0]).toMatchObject({ direction: "expense", count: 3, ids: expect.arrayContaining(ids) });
    expect(groups.map((g) => g.index)).toEqual(groups.map((_, i) => i));
    expect(groups.some((g) => /DONE|XFER|HIDDEN|SPLIT/i.test(g.sample))).toBe(false);
    expect(groups.filter((g) => g.direction === "income")).toHaveLength(2);
  });

  it("caps the number of groups", () => {
    const { db } = setup();
    expect(collectUncategorized(db, { maxGroups: 1 })).toHaveLength(1);
  });
});

describe("parseBatchResponse", () => {
  it("accepts fenced JSON and drops unknown categories, bad confidence and duplicates", () => {
    const { db } = setup();
    const groups = collectUncategorized(db);
    const choices = listCategoryChoices(db);
    const text = `Sure!\n\`\`\`json\n[
      {"i":0,"category":"dining","confidence":"high"},
      {"i":0,"category":"Groceries","confidence":"high"},
      {"i":1,"category":"Not A Category","confidence":"high"},
      {"i":2,"category":"Groceries","confidence":"certain"}
    ]\n\`\`\``;
    const { proposals, rejected } = parseBatchResponse(text, groups, choices);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ categoryName: "Dining", confidence: "high" });
    expect(rejected).toBe(3);
  });

  it("returns nothing for non-JSON", () => {
    const { db } = setup();
    expect(parseBatchResponse("no idea", collectUncategorized(db), listCategoryChoices(db)).proposals).toEqual([]);
  });
});

describe("proposeCategories", () => {
  const llmReturning = (answer: (req: GenerateRequest) => string) => {
    const calls: GenerateRequest[] = [];
    const client: LlmClient = {
      async generate(req) {
        calls.push(req);
        return answer(req);
      },
    };
    return { client, calls };
  };

  it("batches, respects maxCalls, and reports what it did not send or could not resolve", async () => {
    const { db } = setup();
    const groups = collectUncategorized(db); // 3 groups
    const choices = listCategoryChoices(db);
    const { client, calls } = llmReturning(() => `[{"i":${groups[0].index},"category":"Dining","confidence":"high"}]`);
    const r = await proposeCategories(client, groups, choices, { batchSize: 2, maxCalls: 1 });
    expect(calls).toHaveLength(1);
    expect(r.calls).toBe(1);
    expect(r.deferred).toBe(1);
    expect(r.proposals).toHaveLength(1);
    expect(r.unresolved).toHaveLength(1);
    expect(calls[0].user).toContain("Dining");
    expect(calls[0].tools).toBeUndefined();
  });

  it("sends no account ids or amounts beyond the typical figure", async () => {
    const { db } = setup();
    const groups = collectUncategorized(db);
    const { client, calls } = llmReturning(() => "[]");
    await proposeCategories(client, groups, listCategoryChoices(db), { batchSize: 40, maxCalls: 1 });
    expect(calls[0].user).not.toContain("a1");
  });
});

describe("applyProposals", () => {
  it("fills empty categories at or above the confidence bar and optionally writes rules", () => {
    const { db, ids } = setup();
    const dining = categoryId(db, "Dining");
    const groups = collectUncategorized(db);
    const base = groups[0];
    const proposals = [
      {
        key: base.key,
        payee: base.payee,
        categoryId: dining,
        categoryName: "Dining",
        confidence: "high" as const,
        direction: base.direction,
        count: base.count,
        ids: base.ids,
      },
      {
        key: "x",
        payee: "Low Guess",
        categoryId: dining,
        categoryName: "Dining",
        confidence: "low" as const,
        direction: "expense" as const,
        count: 1,
        ids: [999999],
      },
    ];
    const r = applyProposals(db, proposals, { minConfidence: "high", makeRules: true });
    expect(r).toMatchObject({ transactionsUpdated: 3, groupsApplied: 1, groupsSkipped: 1, rulesCreated: 1 });
    const rows = db
      .select()
      .from(transactions)
      .all()
      .filter((t) => ids.includes(t.id));
    expect(rows.every((t) => t.categoryId === dining)).toBe(true);
    const rules = listRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0].actions.categoryId).toBe(dining);

    // Running it again changes nothing and does not duplicate the rule.
    const again = applyProposals(db, proposals, { minConfidence: "high", makeRules: true });
    expect(again).toMatchObject({ transactionsUpdated: 0, rulesCreated: 0 });
    expect(listRules(db)).toHaveLength(1);
  });
});
