import { describe, expect, it } from "vitest";
import { aiMessages, aiProposals, aiThreads } from "@/db/schema";
import {
  AssistantError,
  chat,
  deleteThread,
  getThread,
  listThreads,
  renameThread,
  type ChatEvent,
} from "@/lib/ai/assistant";
import { zonedDayStart } from "@/lib/finance/dates";
import { LlmError, type GenerateRequest, type LlmClient } from "@/lib/llm/types";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const NOW = zonedDayStart("2026-10-24", "UTC") + 12 * 3600;

function setup() {
  const db = freshDb();
  addAccount(db, "a1");
  for (let i = 1; i <= 3; i++) addTxn(db, "a1", { description: `SQ *BLUE BOTTLE COFFEE #${i}`, amountCents: -500 });
  return db;
}
const env = (db: ReturnType<typeof freshDb>, llm: LlmClient, over = {}) => ({
  db,
  llm,
  model: "m",
  now: NOW,
  timeZone: "UTC",
  includeBalances: false,
  ...over,
});
function fake(answer: (req: GenerateRequest) => Promise<string> | string = () => "Hello there") {
  const requests: GenerateRequest[] = [];
  const llm: LlmClient = {
    async generate(req) {
      requests.push(req);
      const out = await answer(req);
      req.onText?.(out);
      return out;
    },
  };
  return { llm, requests };
}
async function run(
  db: ReturnType<typeof freshDb>,
  llm: LlmClient,
  input: { threadId?: number; lens?: "general" | "subscriptions" | "accounts"; text: string },
  over = {},
) {
  const events: ChatEvent[] = [];
  await chat(env(db, llm, over), { lens: "general", ...input }, (e) => events.push(e));
  return events;
}

describe("chat", () => {
  it("creates a thread, saves both messages and streams the answer", async () => {
    const db = setup();
    const { llm } = fake();
    const events = await run(db, llm, { text: "How am I doing this month?" });
    expect(events.map((e) => e.type)).toEqual(["thread", "text", "done"]);
    const t = db.select().from(aiThreads).get()!;
    expect(t).toMatchObject({ title: "How am I doing this month?", lens: "general" });
    const msgs = db.select().from(aiMessages).all();
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "How am I doing this month?"],
      ["assistant", "Hello there"],
    ]);
    expect(msgs[1].model).toBe("m");
  });

  it("passes earlier messages as history, and rejects unknown threads", async () => {
    const db = setup();
    const { llm, requests } = fake((r) => (r.user.startsWith("first") ? "one" : "two"));
    const [{ threadId }] = (await run(db, llm, { text: "first question" })) as [{ type: "thread"; threadId: number }];
    await run(db, llm, { threadId, text: "second question" });
    expect(requests[1].history).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "one" },
    ]);
    await expect(run(db, llm, { threadId: 999, text: "hi" })).rejects.toThrow(AssistantError);
    await expect(run(db, llm, { text: "   " })).rejects.toThrow(/between 1 and 2000/);
  });

  it("keeps the user's message and reports the error when the model fails", async () => {
    const db = setup();
    const { llm } = fake(() => {
      throw new LlmError("The AI provider is rate limiting requests. Try again shortly.", "rate_limit");
    });
    const events = await run(db, llm, { text: "hello" });
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "The AI provider is rate limiting requests. Try again shortly.",
    });
    expect(
      db
        .select()
        .from(aiMessages)
        .all()
        .map((m) => m.role),
    ).toEqual(["user"]);
  });

  it("emits a proposal event when the model calls propose_rule, tied to the thread", async () => {
    const db = setup();
    const { llm } = fake(async (req) => {
      const out = await req.runTool!("propose_rule", { payee: "blue bottle", category: "Dining" });
      expect(out).toContain("Proposal created");
      return "I've suggested a rule.";
    });
    const events = await run(db, llm, { text: "make a rule for blue bottle" });
    const proposal = events.find((e) => e.type === "proposal");
    expect(proposal).toMatchObject({ proposal: { kind: "rule", status: "pending" } });
    const threadId = (events[0] as { threadId: number }).threadId;
    expect(db.select().from(aiProposals).get()).toMatchObject({ threadId, source: "assistant", status: "pending" });
    expect(db.select().from(aiMessages).all()[1].toolsJson).toBe('["propose_rule"]');
    expect(getThread(db, threadId, "UTC").proposals).toHaveLength(1);
  });

  it("only offers the tools a lens allows", async () => {
    const db = setup();
    const { llm, requests } = fake();
    await run(db, llm, { lens: "subscriptions", text: "subs?" });
    const names = requests[0].tools!.map((t) => t.name);
    expect(names).toContain("get_recurring");
    expect(names).toContain("propose_memory");
    expect(names).not.toContain("propose_rule");
    expect(names).not.toContain("get_year_summary");
  });

  it("keeps the system prompt identical before 'Today is' across months", async () => {
    const db = setup();
    const { llm, requests } = fake();
    await run(db, llm, { text: "one" });
    await run(db, llm, { text: "two" }, { now: NOW + 40 * 86_400 });
    const stable = (s: string) => s.split("Today is")[0];
    expect(stable(requests[0].system)).toBe(stable(requests[1].system));
    expect(requests[0].system).toContain("Today is 2026-10-24");
    expect(requests[1].system).not.toBe(requests[0].system);
  });

  it("sends no account name or balance without the opt-in, even through get_facts", async () => {
    const db = freshDb();
    addAccount(db, "jar", {
      isManual: true,
      displayName: "Secret Cash Jar",
      balanceCents: 777_00,
      createdAt: NOW - 70 * 86_400,
    });
    const outputs: string[] = [];
    const { llm, requests } = fake(async (req) => {
      outputs.push(await req.runTool!("get_facts", {}));
      return "ok";
    });
    await run(db, llm, { lens: "accounts", text: "anything?" });
    const wire = JSON.stringify([requests, outputs]);
    expect(wire).not.toContain("Secret Cash Jar");
    expect(wire).not.toContain("777");
    expect(wire).toContain("manual account");
  });
});

describe("rolling summary", () => {
  it("summarizes only past 24 messages, then uses it in later prompts", async () => {
    const db = setup();
    const { llm, requests } = fake((r) => (r.system.startsWith("You summarize") ? "SUMMARY OF EARLIER" : "answer"));
    const [{ threadId }] = (await run(db, llm, { text: "turn 1" })) as [{ type: "thread"; threadId: number }];
    for (let i = 2; i <= 12; i++) await run(db, llm, { threadId, text: `turn ${i}` });
    expect(requests.some((r) => r.system.startsWith("You summarize"))).toBe(false); // 24 messages: not past it
    await run(db, llm, { threadId, text: "turn 13" });
    expect(requests.filter((r) => r.system.startsWith("You summarize"))).toHaveLength(1);
    const t = db.select().from(aiThreads).get()!;
    expect(t.summary).toBe("SUMMARY OF EARLIER");
    expect(t.summaryUpTo).not.toBeNull();
    await run(db, llm, { threadId, text: "turn 14" });
    const last = requests.filter((r) => !r.system.startsWith("You summarize")).at(-1)!;
    expect(last.system).toContain("Earlier in this conversation: SUMMARY OF EARLIER");
    expect(last.history).toHaveLength(12);
  });

  it("ignores a failing summary call", async () => {
    const db = setup();
    const { llm } = fake((r) => {
      if (r.system.startsWith("You summarize")) throw new Error("boom");
      return "answer";
    });
    const [{ threadId }] = (await run(db, llm, { text: "turn 1" })) as [{ type: "thread"; threadId: number }];
    for (let i = 2; i <= 13; i++) await run(db, llm, { threadId, text: `turn ${i}` });
    expect(db.select().from(aiThreads).get()!.summary).toBeNull();
  });
});

describe("threads", () => {
  it("lists, renames and deletes, keeping proposals but clearing their thread", async () => {
    const db = setup();
    const { llm } = fake(async (req) => {
      await req.runTool!("propose_memory", { text: "Rent is paid to Acme" });
      return "done";
    });
    const events = await run(db, llm, { text: "remember rent" });
    const id = (events[0] as { threadId: number }).threadId;
    expect(listThreads(db)).toMatchObject([{ id, title: "remember rent" }]);
    renameThread(db, id, "  Rent  ");
    expect(listThreads(db)[0].title).toBe("Rent");
    expect(() => renameThread(db, id, " ")).toThrow(AssistantError);
    deleteThread(db, id);
    expect(db.select().from(aiThreads).all()).toEqual([]);
    expect(db.select().from(aiMessages).all()).toEqual([]);
    expect(db.select().from(aiProposals).all()).toMatchObject([{ threadId: null }]);
    expect(() => getThread(db, id, "UTC")).toThrow(AssistantError);
  });
});
