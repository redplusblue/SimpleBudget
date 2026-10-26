import { describe, expect, it } from "vitest";
import { acceptRuleProposal, listProposals } from "@/lib/ai/proposals";
import { suggestAll } from "@/lib/ai/rule-suggestions";
import { collectTagMerchants, suggestTagRules } from "@/lib/ai/tag-suggestions";
import type { LlmClient } from "@/lib/llm/types";
import { createRule, listRules } from "@/lib/rules/store";
import { transactionTags } from "@/db/schema";
import { addAccount, addTag, addTxn, freshDb } from "../helpers/db";

const NOW = 1_760_000_000;
const recent = (n: number) => NOW - n * 86_400;

function setup() {
  const db = freshDb();
  addAccount(db, "a1");
  const subs = addTag(db, "Subscriptions");
  for (const d of [3, 33]) addTxn(db, "a1", { description: "NETFLIX.COM", posted: recent(d), amountCents: -1599 });
  for (const d of [4, 34]) addTxn(db, "a1", { description: "HULU", posted: recent(d), amountCents: -999 });
  addTxn(db, "a1", { description: "ONE OFF SHOP", posted: recent(5) }); // only once
  for (const d of [200, 230]) addTxn(db, "a1", { description: "OLD GYM", posted: recent(d) }); // too old
  return { db, subs: subs.id ?? subs };
}
const fake = (answer: (user: string) => string): { llm: LlmClient; users: string[] } => {
  const users: string[] = [];
  return {
    users,
    llm: {
      async generate(req) {
        users.push(req.user);
        return answer(req.user);
      },
    },
  };
};
const idx = (user: string, name: string) => Number(new RegExp(`(\\d+)\\. ${name}`, "i").exec(user)![1]);
const env = (db: ReturnType<typeof freshDb>, llm: LlmClient) => ({ db, llm, model: "m", now: NOW, timeZone: "UTC" });

describe("collectTagMerchants", () => {
  it("needs two recent transactions and skips merchants that already have a tag rule", () => {
    const { db, subs } = setup();
    expect(
      collectTagMerchants(db, NOW)
        .map((m) => m.name.toLowerCase())
        .sort(),
    ).toEqual(["hulu", "netflix.com"]);
    createRule(db, {
      name: "t",
      match: "any",
      conditions: [{ field: "payee", op: "equals", value: "Hulu" }],
      actions: { addTagIds: [Number(subs)] },
    });
    expect(collectTagMerchants(db, NOW).map((m) => m.name.toLowerCase())).toEqual(["netflix.com"]);
  });
});

describe("suggestTagRules", () => {
  it("proposes tag rules from existing tags, with one shared rule per tag", async () => {
    const { db, subs } = setup();
    const { llm } = fake((u) =>
      JSON.stringify([
        { i: idx(u, "netflix"), tags: ["subscriptions", "Invented"], confidence: "high" },
        { i: idx(u, "hulu"), tags: ["Subscriptions"], confidence: "medium" },
      ]),
    );
    const r = await suggestTagRules(env(db, llm), { maxMerchants: 10 });
    expect(r).toMatchObject({ created: 2, noMatch: 0 });
    const list = listProposals(db, { status: "pending" });
    expect(list.every((p) => p.payload.action.type === "tag")).toBe(true);
    expect(list.map((p) => p.row.subjectKey).sort()).toEqual([`tag:hulu:${subs}`, `tag:netflixcom:${subs}`].sort());
    expect(list.map((p) => p.payload.target.mode).sort()).toEqual(["extend", "new"]);
    expect(list[0].payload.target).toMatchObject({ ruleName: "AI tag · Subscriptions" });
    expect(list[0].preview).toMatchObject({ conflicts: 0 });
  });

  it("accepting tags the existing transactions, one rule for both", async () => {
    const { db } = setup();
    const { llm } = fake((u) =>
      JSON.stringify([
        { i: idx(u, "netflix"), tags: ["Subscriptions"], confidence: "high" },
        { i: idx(u, "hulu"), tags: ["Subscriptions"], confidence: "high" },
      ]),
    );
    await suggestTagRules(env(db, llm), { maxMerchants: 10 });
    for (const p of listProposals(db, { status: "pending" }).reverse())
      acceptRuleProposal(db, p.row.id, { applyExisting: true }, NOW);
    expect(listRules(db)).toHaveLength(1);
    expect(listRules(db)[0].conditions).toHaveLength(2);
    expect(db.select().from(transactionTags).all()).toHaveLength(4);
  });

  it("stores no_match for merchants with no tags, and asks each merchant once", async () => {
    const { db } = setup();
    const { llm, users } = fake((u) => JSON.stringify([{ i: idx(u, "netflix"), tags: [], confidence: "low" }]));
    const r = await suggestTagRules(env(db, llm), { maxMerchants: 10 });
    expect(r).toMatchObject({ created: 0, noMatch: 2 });
    const again = await suggestTagRules(env(db, llm), { maxMerchants: 10 });
    expect(again.skipped).toBe("none_eligible");
    expect(users).toHaveLength(1);
  });

  it("skips with no_tags when the owner has no tags", async () => {
    const db = freshDb();
    addAccount(db, "a1");
    const { llm, users } = fake(() => "[]");
    expect((await suggestTagRules(env(db, llm), { maxMerchants: 10 })).skipped).toBe("no_tags");
    expect(users).toHaveLength(0);
  });
});

describe("suggestAll", () => {
  const run = (opts: { maxMerchants: number; suggestTags: boolean }, budgetOk?: () => boolean) => {
    const { db } = setup();
    const { llm, users } = fake(() => "[]");
    return suggestAll({ ...env(db, llm), budgetOk }, opts).then((r) => ({ r, users }));
  };

  it("does nothing for tags when they are switched off", async () => {
    expect((await run({ maxMerchants: 10, suggestTags: false })).r.tags).toBeUndefined();
  });

  it("skips tags when the per-run cap is used up or the budget is gone", async () => {
    expect((await run({ maxMerchants: 1, suggestTags: true })).r.tags).toEqual({ skipped: "no_capacity" });
    expect((await run({ maxMerchants: 50, suggestTags: true }, () => false)).r.tags).toEqual({ skipped: "no_budget" });
  });

  it("asks about tags after categories when there is room", async () => {
    const { r, users } = await run({ maxMerchants: 50, suggestTags: true });
    expect(r.tags).toMatchObject({ calls: 1 });
    expect(users.at(-1)!.startsWith("Tags:")).toBe(true);
  });
});
