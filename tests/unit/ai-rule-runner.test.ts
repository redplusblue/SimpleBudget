import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRuns } from "@/db/schema";
import { runExclusive, maybeSuggestRules } from "@/lib/ai/rule-runner";
import { getRuleSuggestSettings, setRuleSuggestLastRun, updateRuleSuggestSettings } from "@/lib/ai/rule-settings";
import { listProposals } from "@/lib/ai/proposals";
import type { FeatureLlm } from "@/lib/llm";
import { updateAiConfig } from "@/lib/llm/config";
import type { LlmClient } from "@/lib/llm/types";
import { updateNotifyConfig } from "@/lib/notify/config";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const NOW = 1_760_000_000;

function setup(merchants = 6) {
  const db = freshDb();
  addAccount(db, "a1");
  for (let i = 0; i < merchants; i++) addTxn(db, "a1", { description: `SHOP${String.fromCharCode(65 + i)}SHOP #1` });
  return db;
}
const answerAll: LlmClient = {
  async generate(req) {
    const idx = [...req.user.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    return JSON.stringify(idx.map((i) => ({ i, category: "Dining", confidence: "high" })));
  },
};
const deps = (client: LlmClient | null = answerAll, fetchImpl?: typeof fetch) => ({
  getLlm: (): FeatureLlm | null => (client ? { llm: client, model: "m", entry: undefined } : null),
  fetchImpl,
});
const run = (db: ReturnType<typeof freshDb>, d = deps(), trigger: "after_sync" | "interval" = "after_sync") =>
  maybeSuggestRules(db, trigger, NOW, "UTC", d);

afterEach(() => vi.unstubAllGlobals());

describe("maybeSuggestRules", () => {
  it("does nothing when AI is off", async () => {
    expect(await run(setup(), deps(null))).toEqual({ ran: false, reason: "disabled" });
  });

  it("respects the schedule", async () => {
    const db = setup();
    updateRuleSuggestSettings(db, { schedule: "manual" });
    expect((await run(db)).reason).toBe("schedule");
    updateRuleSuggestSettings(db, { schedule: "interval", intervalDays: 7 });
    expect((await run(db, deps(), "after_sync")).reason).toBe("schedule");
    setRuleSuggestLastRun(db, NOW - 3 * 86_400);
    expect((await run(db, deps(), "interval")).reason).toBe("schedule"); // not due yet
    setRuleSuggestLastRun(db, NOW - 8 * 86_400);
    expect((await run(db, deps(), "interval")).ran).toBe(true);
  });

  it("waits for enough merchants and for budget", async () => {
    expect((await run(setup(3))).reason).toBe("too_few");
    const db = setup();
    updateAiConfig(db, { model: "m", monthlyBudgetMicros: 0 });
    expect((await run(db)).reason).toBe("budget");
  });

  it("refuses while another run is in progress", async () => {
    const db = setup();
    let release!: () => void;
    const hold = runExclusive(() => new Promise<void>((r) => (release = r)));
    expect((await run(db)).reason).toBe("busy");
    release();
    await hold;
    expect((await run(db)).ran).toBe(true);
  });

  it("writes proposals and last_run_at, and tracks the run", async () => {
    const db = setup();
    const r = await run(db);
    expect(r).toMatchObject({ ran: true, reason: "ok", result: { created: 6 } });
    expect(listProposals(db, { status: "pending" })).toHaveLength(6);
    expect(getRuleSuggestSettings(db).lastRunAt).toBe(NOW);
    const row = db.select().from(aiRuns).get()!;
    expect(row).toMatchObject({ feature: "rules", trigger: "after_sync", status: "ok" });
    expect(listProposals(db)[0].row.aiRunId).toBe(row.id);
  });

  it("never throws: a failing model is reported as an error", async () => {
    const db = setup();
    const bad: LlmClient = { generate: () => Promise.reject(new Error("boom")) };
    expect((await run(db, deps(bad))).reason).toBe("error");
  });

  it("sends one alert when alerts are on", async () => {
    const db = setup();
    updateNotifyConfig(db, { enabled: true, kind: "ntfy", url: "https://ntfy.example/topic" });
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await run(db, deps(answerAll, fetchMock as unknown as typeof fetch));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.title).toBe("Rule suggestions ready");
    expect(init.headers.tags).toBe("bulb");
    expect(init.body).toContain("6 new rule suggestions");
  });
});

describe("settings", () => {
  it("has defaults and validates", () => {
    const db = freshDb();
    expect(getRuleSuggestSettings(db)).toEqual({
      schedule: "after_sync",
      intervalDays: 7,
      minNewMerchants: 5,
      maxMerchantsPerRun: 100,
      suggestTags: false,
      lastRunAt: null,
    });
    expect(updateRuleSuggestSettings(db, { schedule: "interval", intervalDays: 30 })).toMatchObject({
      schedule: "interval",
      intervalDays: 30,
    });
    expect(() => updateRuleSuggestSettings(db, { intervalDays: 0 })).toThrow();
    expect(() => updateRuleSuggestSettings(db, { bogus: 1 })).toThrow();
  });
});
