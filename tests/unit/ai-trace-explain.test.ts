import { describe, expect, it } from "vitest";
import { accounts, transactions } from "@/db/schema";
import { addMemory } from "@/lib/ai/memory";
import { explainTrace, type TraceEvent } from "@/lib/ai/trace-explain";
import { traceForModel } from "@/lib/ai/trace-model";
import { listProposals } from "@/lib/ai/proposals";
import { zonedDayStart } from "@/lib/finance/dates";
import { traceTransaction } from "@/lib/finance/trace";
import { createToolRunner } from "@/lib/llm/tools";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const at = (date: string) => zonedDayStart(date, "UTC") + 12 * 3600;
const NOW = at("2026-10-24");

function setup() {
  const db = freshDb();
  addAccount(db, "ACT-secret-9", { name: "Secret Savings Name" });
  const add = (date: string, dollars: number, over = {}) =>
    addTxn(db, "ACT-secret-9", {
      posted: at(date),
      amountCents: Math.round(dollars * 100),
      payee: "Blue Bottle Coffee",
      description: "SQ *BLUE BOTTLE COFFEE #77 SECRET BANK TEXT",
      memo: "SECRET-MEMO",
      notes: "SECRET-NOTE",
      ...over,
    });
  const ids = [add("2026-09-01", -5), add("2026-09-15", -5), add("2026-10-01", -5), add("2026-10-02", 2)].map(
    (t) => t.id,
  );
  return { db, ids };
}

describe("traceForModel", () => {
  it("carries statistics only: no ids, account, memo, note or raw bank text", () => {
    const { db, ids } = setup();
    const wire = JSON.stringify(traceForModel(traceTransaction(db, ids[2], NOW, "UTC")!));
    for (const secret of [
      "ACT-secret-9",
      "Secret Savings Name",
      "SECRET-MEMO",
      "SECRET-NOTE",
      "SECRET BANK TEXT",
      "transactionId",
      '"id"',
      ...ids.map((i) => `"id":${i}`),
    ])
      expect(wire).not.toContain(secret);
    expect(wire).toContain("$5.00"); // the statistics are there
    expect(wire).toContain('"refunds":[{"date":"2026-10-02","amount":"$2.00"}]');
  });
});

describe("explainTrace", () => {
  function run(
    db: ReturnType<typeof freshDb>,
    id: number,
    answer: (r: GenerateRequest) => Promise<string> | string,
    question?: string,
  ) {
    const requests: GenerateRequest[] = [];
    const events: TraceEvent[] = [];
    const llm: LlmClient = {
      async generate(req) {
        requests.push(req);
        const out = await answer(req);
        req.onText?.(out);
        return out;
      },
    };
    const env = { db, llm, model: "m", now: NOW, timeZone: "UTC", includeBalances: false };
    return explainTrace(env, id, question, (e) => events.push(e)).then(() => ({ requests, events }));
  }

  it("puts the statistics and question in the user message and offers the right tools", async () => {
    const { db, ids } = setup();
    addMemory(db, "Coffee is a treat", "user", 1);
    const { requests, events } = await run(db, ids[2], () => "It looks normal.", "Why so often?");
    const r = requests[0];
    expect(r.user).toContain('"merchant"');
    expect(r.user).toContain("$5.00");
    expect(r.user.endsWith("Why so often?")).toBe(true);
    expect(r.tools!.map((t) => t.name).sort()).toEqual(
      ["get_merchant_history", "get_recurring", "propose_memory", "propose_rule", "search_transactions"].sort(),
    );
    expect(r.system).toContain("Coffee is a treat");
    expect(r.maxTokens).toBe(600);
    expect(events.map((e) => e.type)).toEqual(["text", "done"]);
    expect(JSON.stringify(requests)).not.toMatch(/SECRET|ACT-secret/);
  });

  it("uses the default question, and lets the model propose a rule", async () => {
    const { db, ids } = setup();
    const { requests, events } = await run(db, ids[0], async (req) => {
      await req.runTool!("propose_rule", { payee: "blue bottle", category: "Dining" });
      return "Suggested a rule.";
    });
    expect(requests[0].user).toContain("Is this charge normal");
    expect(events.some((e) => e.type === "proposal")).toBe(true);
    expect(listProposals(db, { status: "pending" })[0].row.threadId).toBeNull();
  });

  it("rejects a missing transaction", async () => {
    const { db } = setup();
    await expect(run(db, 9999, () => "x")).rejects.toThrow(/not found/);
  });
});

describe("get_merchant_trace tool", () => {
  it("returns the model-safe trace of the best matching merchant", () => {
    const { db } = setup();
    db.update(accounts).set({ name: "Secret Savings Name" }).run();
    const out = createToolRunner(db, NOW, "UTC")("get_merchant_trace", { query: "blue bottle" });
    expect(out).toContain("history");
    expect(out).not.toMatch(/SECRET|ACT-secret|transactionId/);
    expect(createToolRunner(db, NOW, "UTC")("get_merchant_trace", { query: "zzzz" })).toContain(
      "No transactions match",
    );
    expect(db.select().from(transactions).all().length).toBe(4);
  });
});
