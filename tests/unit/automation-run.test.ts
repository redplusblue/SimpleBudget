import { describe, expect, it } from "vitest";
import { aiRuns, aiThreads, automationRuns } from "@/db/schema";
import { createDestination } from "@/lib/automations/destinations";
import { KEEP_RUNS, MAX_MESSAGES, runAutomation, type RunContext, type TxnLite } from "@/lib/automations/run";
import { createAutomation, getAutomation, listRuns } from "@/lib/automations/store";
import type { AutomationInput } from "@/lib/automations/types";
import { zonedDayStart } from "@/lib/finance/dates";
import { updateAiConfig } from "@/lib/llm/config";
import type { FeatureLlm } from "@/lib/llm";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import type { Notification } from "@/lib/notify/send";
import { addAccount, freshDb } from "../helpers/db";

const NOW = zonedDayStart("2026-10-24", "UTC") + 12 * 3600;
const SCHEDULE = { type: "schedule" as const, every: "day" as const, hour: 9, minute: 0 as const };

function setup() {
  const db = freshDb();
  const dest = createDestination(db, { name: "Server", kind: "webhook", url: "https://hooks.example/secret-path" });
  updateAiConfig(db, { model: "m" });
  const sent: Notification[] = [];
  const ctx = (over: Partial<RunContext> = {}, ok = true): RunContext => ({
    now: NOW,
    timeZone: "UTC",
    trigger: "manual",
    ...over,
    deps: {
      send: async (_db, _id, n) => {
        sent.push(n);
        return { ok, status: ok ? 200 : 500 };
      },
      ...over.deps,
    },
  });
  const make = (over: Partial<AutomationInput> = {}) =>
    getAutomation(
      db,
      createAutomation(db, {
        name: "Auto",
        trigger: SCHEDULE,
        action: { type: "message", text: "Hi {today}" },
        destinationId: dest.id,
        ...over,
      }).id,
    );
  return { db, make, sent, ctx };
}

const txn = (i: number): TxnLite => ({
  id: i,
  date: "2026-10-2" + (i % 5),
  payee: `Shop ${i}`,
  amountCents: -1000 * i,
  category: "Dining",
  account: "Secret Checking",
});

function fakeLlm(answer: (r: GenerateRequest) => string) {
  const requests: GenerateRequest[] = [];
  const client: LlmClient = {
    async generate(req) {
      requests.push(req);
      const out = answer(req);
      req.onText?.(out);
      return out;
    },
  };
  const picked: FeatureLlm = { llm: client, model: "m", entry: undefined };
  return { requests, getLlm: () => picked };
}

describe("message action", () => {
  it("renders the template and records a sent run", async () => {
    const { db, make, sent, ctx } = setup();
    const a = make({ action: { type: "message", text: "Spent {month_spent} of {month_income} on {today}" } });
    expect(await runAutomation(db, a, ctx())).toEqual({ status: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event: "automation",
      title: "Auto",
      message: "Spent $0.00 of $0.00 on 2026-10-24",
    });
    expect(listRuns(db, a.id)).toMatchObject([{ status: "sent", preview: "Spent $0.00 of $0.00 on 2026-10-24" }]);
    expect(getAutomation(db, a.id)).toMatchObject({ lastStatus: "sent", lastRunAt: NOW });
  });

  it("sends one message per match up to 5, then a summary, hiding names unless allowed", async () => {
    const { db, make, sent, ctx } = setup();
    const trigger = {
      type: "transaction" as const,
      match: "all" as const,
      includePending: false,
      conditions: [{ field: "amount" as const, op: "gt" as const, value: 100 }],
    };
    const text = "{payee} {amount} {date} {category} {account}";
    const matches = [1, 2, 3, 4, 5, 6, 7].map(txn);
    await runAutomation(db, make({ trigger, action: { type: "message", text } }), ctx({ matches }));
    expect(sent).toHaveLength(MAX_MESSAGES + 1);
    expect(sent[0].message).toBe("a merchant $10.00 2026-10-21 Dining an account");
    expect(sent.at(-1)!.message).toBe("…and 2 more.");

    sent.length = 0;
    await runAutomation(
      db,
      make({ trigger, action: { type: "message", text }, includeDetails: true }),
      ctx({ matches: [txn(1)] }),
    );
    expect(sent[0].message).toBe("Shop 1 $10.00 2026-10-21 Dining Secret Checking");
  });
});

describe("fact action", () => {
  function withFacts() {
    const s = setup();
    addAccount(s.db, "jar", { isManual: true, displayName: "Secret Cash Jar", createdAt: NOW - 70 * 86_400 });
    addAccount(s.db, "jar2", { isManual: true, displayName: "Other Jar", createdAt: NOW - 40 * 86_400 });
    return s;
  }

  it("picks the top fact, redacted unless details are on", async () => {
    const { db, make, sent, ctx } = withFacts();
    await runAutomation(db, make({ action: { type: "fact", lens: "accounts", pick: "top" } }), ctx());
    expect(sent[0].title).toBe("One of your manual accounts hasn't been updated in 70 days");
    expect(JSON.stringify(sent)).not.toContain("Secret Cash Jar");
    await runAutomation(
      db,
      make({ action: { type: "fact", lens: "accounts", pick: "top" }, includeDetails: true }),
      ctx(),
    );
    expect(sent[1].title).toContain("Secret Cash Jar");
    expect(sent[1].severity).toBe("warn");
  });

  it("picks randomly through the injected RNG, and skips when there is nothing to say", async () => {
    const { db, make, sent, ctx } = withFacts();
    const random = make({ action: { type: "fact", lens: "accounts", pick: "random" } });
    await runAutomation(db, random, ctx({ deps: { random: () => 0.99 } }));
    expect(sent[0].title).toContain("40 days"); // the second fact
    const empty = setup();
    const out = await runAutomation(
      empty.db,
      empty.make({ action: { type: "fact", lens: "goals", pick: "top" } }),
      empty.ctx(),
    );
    expect(out).toEqual({ status: "skipped", reason: "nothing to report" });
    expect(empty.sent).toHaveLength(0);
    expect(listRuns(empty.db, 1)).toMatchObject([{ status: "skipped", reason: "nothing to report" }]);
  });
});

describe("AI actions", () => {
  const insight = { type: "ai_insight" as const, lens: "accounts" as const, count: 1 };
  const citing = (req: GenerateRequest) => {
    const id = [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1])[0];
    return JSON.stringify([{ facts: [id], severity: "warn", title: "Card title", body: "Card body" }]);
  };

  function withAi() {
    const s = setup();
    addAccount(s.db, "jar", { isManual: true, displayName: "Secret Cash Jar", createdAt: NOW - 70 * 86_400 });
    return s;
  }

  it("generates cards, sends them, and records the AI run", async () => {
    const { db, make, sent, ctx } = withAi();
    const llm = fakeLlm(citing);
    const a = make({ action: insight });
    expect(await runAutomation(db, a, ctx({ deps: { getLlm: llm.getLlm } }))).toEqual({ status: "sent" });
    expect(sent[0].message).toBe("Card title\nCard body");
    const row = db.select().from(aiRuns).get()!;
    expect(row).toMatchObject({
      feature: "automations",
      trigger: "automation",
      subject: `automation ${a.id}`,
      status: "ok",
    });
    expect(db.select().from(automationRuns).get()!.aiRunId).toBe(row.id);
    expect(JSON.stringify(llm.requests)).not.toContain("Secret Cash Jar");
  });

  it("is skipped, with a reason, when AI is off or the budget is used up", async () => {
    const { db, make, sent, ctx } = withAi();
    const a = make({ action: insight });
    expect(await runAutomation(db, a, ctx({ deps: { getLlm: () => null } }))).toEqual({
      status: "skipped",
      reason: "AI is off",
    });
    updateAiConfig(db, { monthlyBudgetMicros: 0 });
    const llm = fakeLlm(citing);
    expect(await runAutomation(db, a, ctx({ deps: { getLlm: llm.getLlm } }))).toEqual({
      status: "skipped",
      reason: "monthly AI budget reached",
    });
    expect(llm.requests).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("runs a prompt as a read-only conversation in a titled thread, with the matched transactions", async () => {
    const { db, make, sent, ctx } = withAi();
    const long = "word ".repeat(1200);
    const llm = fakeLlm(() => long);
    const trigger = {
      type: "transaction" as const,
      match: "all" as const,
      includePending: false,
      conditions: [{ field: "amount" as const, op: "gt" as const, value: 1 }],
    };
    const matches = Array.from({ length: 25 }, (_, i) => txn(i + 1));
    const a = make({ trigger, action: { type: "ai_prompt", lens: "spending", prompt: "What stands out?" } });
    expect((await runAutomation(db, a, ctx({ matches, deps: { getLlm: llm.getLlm } }))).status).toBe("sent");
    expect(db.select().from(aiThreads).get()).toMatchObject({ title: "Automation: Auto", lens: "spending" });
    const req = llm.requests[0];
    expect(req.tools!.some((t) => t.name.startsWith("propose_"))).toBe(false);
    expect(req.user).toContain("What stands out?");
    expect(req.user.match(/^- /gm)).toHaveLength(20);
    expect(req.user).not.toContain("Shop 1,"); // names hidden unless allowed
    expect(sent[0].message.length).toBeLessThanOrEqual(4000);
    expect(sent[0].message.endsWith("Full answer in the Assistant.")).toBe(true);
  });
});

describe("delivery, dedupe and history", () => {
  it("records a plain error when the destination refuses, never a URL, and never throws", async () => {
    const { db, make, ctx } = setup();
    const a = make();
    const out = await runAutomation(db, a, ctx({}, false));
    expect(out).toEqual({ status: "error", reason: "The destination didn't accept the message." });
    const boom = await runAutomation(db, a, {
      ...ctx(),
      deps: {
        send: async () => {
          throw new Error("https://hooks.example/secret-path exploded");
        },
      },
    });
    expect(boom.status).toBe("error");
    expect(JSON.stringify(listRuns(db, a.id))).not.toContain("secret-path");
  });

  it("fires a dedupe key once, but an earlier failure doesn't block it", async () => {
    const { db, make, sent, ctx } = setup();
    const a = make();
    await runAutomation(db, a, ctx({ dedupeKey: "target:1:2026-10" }, false)); // fails
    expect((await runAutomation(db, a, ctx({ dedupeKey: "target:1:2026-10" }))).status).toBe("sent");
    expect(await runAutomation(db, a, ctx({ dedupeKey: "target:1:2026-10" }))).toEqual({
      status: "skipped",
      reason: "already sent",
    });
    expect(await runAutomation(db, a, ctx({ dedupeKey: "target:2:2026-10" }))).toEqual({ status: "sent" });
    expect(sent).toHaveLength(3); // one failed attempt, two sent
  });

  it("keeps only the newest 50 runs", async () => {
    const { db, make, ctx } = setup();
    const a = make();
    for (let i = 0; i < KEEP_RUNS + 5; i++) await runAutomation(db, a, ctx({ now: NOW + i }));
    const runs = listRuns(db, a.id, 100);
    expect(runs).toHaveLength(KEEP_RUNS);
    expect(runs[0].startedAt).toBe(NOW + KEEP_RUNS + 4);
  });
});
