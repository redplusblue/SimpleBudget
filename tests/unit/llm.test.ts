import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRuns, insightsCache, settings, syncRuns } from "@/db/schema";
import { addConnection } from "@/lib/connections";
import { zonedDayStart } from "@/lib/finance/dates";
import { createOpenAiCompatibleClient } from "@/lib/llm/openai-compatible";
import { AiConfigError, getAiConfig, getApiKey, updateAiConfig } from "@/lib/llm/config";
import { buildAiContext } from "@/lib/llm/context";
import { getLlm, withDevLogging } from "@/lib/llm";
import { answerQuestion, generateSummary, getCachedSummary } from "@/lib/llm/narrative";
import { trackRuns } from "@/lib/llm/runs";
import { createToolRunner } from "@/lib/llm/tools";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");
const ACCESS_URL = "https://demo-user:s3cr3t-token@bridge.simplefin.org/simplefin";
const ACCOUNT_ID = "ACT-8d1f2e7c-secret-id";

function dataset() {
  const db = freshDb();
  addConnection(db, ACCESS_URL);
  addAccount(db, ACCOUNT_ID, {
    name: "Checking ...4821",
    displayName: "Everyday",
    balanceCents: 30_000,
    lowBalanceCents: 50_000,
  });
  const dining = categoryId(db, "Dining");
  const spend = (date: string, dollars: number, description: string, notes?: string) =>
    addTxn(db, ACCOUNT_ID, {
      posted: at(date),
      amountCents: -dollars * 100,
      description,
      categoryId: dining,
      notes,
      memo: "MEMO-ACCT-4821",
    });
  for (const m of ["2026-07", "2026-08", "2026-09"]) spend(`${m}-10`, 100, "BLUE BOTTLE COFFEE #123");
  spend("2026-10-05", 250, "BLUE BOTTLE COFFEE #123", "private note about my diet");
  return { db, spend };
}

function fakeLlm(answer = "OK") {
  const requests: GenerateRequest[] = [];
  const toolOutputs: string[] = [];
  const client: LlmClient = {
    async generate(req) {
      requests.push(req);
      if (req.runTool) {
        toolOutputs.push(await req.runTool("search_transactions", { query: "coffee" }));
        toolOutputs.push(await req.runTool("get_category_totals", { month: "2026-10" }));
      }
      req.onText?.(answer);
      return answer;
    },
  };
  return { client, requests, toolOutputs };
}

const wire = (req: GenerateRequest, extra: string[] = []) =>
  JSON.stringify([req.system, req.user, req.history, ...extra]);
const SECRETS = [
  ACCESS_URL,
  "s3cr3t-token",
  "demo-user",
  "bridge.simplefin.org",
  ACCOUNT_ID,
  "8d1f2e7c",
  "4821",
  "MEMO-ACCT",
  "private note",
  "http",
];

describe("what the model is allowed to see", () => {
  it("the summary request contains aggregates but no account ids, access URL, memos or notes", async () => {
    const { db } = dataset();
    const fake = fakeLlm();
    await generateSummary({ db, llm: fake.client, model: "m", includeBalances: false, now: NOW, timeZone: TZ });
    const payload = wire(fake.requests[0]);
    for (const secret of SECRETS) expect(payload).not.toContain(secret);
    expect(payload).toContain("Dining"); // aggregates are there
    expect(payload).toContain("$250.00");
    expect(payload).not.toContain("Everyday"); // account names and balances are opt-in
    expect(payload).not.toContain("low-balance");
    expect(payload).not.toMatch(/running low/);
  });

  it("question answering and its tools leak nothing either", async () => {
    const { db } = dataset();
    const fake = fakeLlm();
    await answerQuestion(
      { db, llm: fake.client, model: "m", includeBalances: false, now: NOW, timeZone: TZ },
      "How much coffee did I buy?",
    );
    const payload = wire(fake.requests[0], fake.toolOutputs);
    for (const secret of SECRETS) expect(payload).not.toContain(secret);
    expect(fake.toolOutputs[0]).toContain("BLUE BOTTLE COFFEE"); // payee, normalized, is allowed
    expect(fake.requests[0].tools?.map((t) => t.name)).toEqual([
      "get_category_totals",
      "search_transactions",
      "get_period_report",
      "get_monthly_trend",
      "get_recurring",
      "get_year_summary",
      "get_merchant_history",
    ]);
  });

  it("the analysis tools answer from the data and leak nothing", () => {
    const { db } = dataset();
    const run = createToolRunner(db, NOW, TZ);
    const period = JSON.parse(run("get_period_report", { month: "2026-10" }));
    expect(period.spent).toBe("$250.00");
    expect(period.categories[0]).toMatchObject({ name: "Dining", previous: "$100.00" });
    const range = JSON.parse(run("get_period_report", { from: "2026-07-01", to: "2026-10-31" }));
    expect(range.spent).toBe("$550.00");

    const trend = JSON.parse(run("get_monthly_trend", { end_month: "2026-10" }));
    expect(trend.months).toHaveLength(12);
    expect(trend.months.at(-1)).toMatchObject({ month: "2026-10", spent: "$250.00" });

    const year = JSON.parse(run("get_year_summary", { year: 2026 }));
    expect(year.spent).toBe("$550.00");
    expect(year.topCategories[0].name).toBe("Dining");

    const history = JSON.parse(run("get_merchant_history", { query: "blue bottle" }));
    expect(history.matchingTransactions).toBe(4);
    expect(history.byMonth[0]).toMatchObject({ month: "2026-10", net: "-$250.00" });

    const recurring = JSON.parse(run("get_recurring", {}));
    expect(recurring.active.length + recurring.probablyCancelled.length).toBeGreaterThan(0);

    const everything = JSON.stringify([period, range, trend, year, history, recurring]);
    for (const secret of SECRETS) expect(everything).not.toContain(secret);

    expect(() => run("get_period_report", { month: "October" })).toThrow();
    expect(() => run("get_year_summary", { year: "soon" })).toThrow();
    expect(() => run("get_merchant_history", { query: "" })).toThrow();
  });

  it("balances and account names are included only after opting in, and still never ids", () => {
    const { db } = dataset();
    const args = { now: NOW, timeZone: TZ, month: "2026-10" };
    const off = JSON.stringify(buildAiContext(db, { ...args, includeBalances: false }));
    expect(off).not.toContain("Everyday");
    const on = JSON.stringify(buildAiContext(db, { ...args, includeBalances: true }));
    expect(on).toContain("Everyday");
    expect(on).toContain("$300.00");
    expect(on).toContain("running low");
    expect(on).not.toContain(ACCOUNT_ID);
    expect(on).not.toContain("s3cr3t");
  });

  it("search is capped at 50 rows and validates its input", () => {
    const { db, spend } = dataset();
    for (let i = 0; i < 60; i++) spend("2026-10-10", 5, "CORNER BAKERY");
    const run = createToolRunner(db, NOW, TZ);
    const out = JSON.parse(run("search_transactions", { query: "bakery" }));
    expect(out.shown).toBe(50);
    expect(out.matches).toBe(60);
    expect(out.transactions[0]).toEqual({
      date: "2026-10-10",
      payee: expect.stringContaining("CORNER BAKERY"),
      amount: "-$5.00",
      category: "Dining",
    });
    expect(() => run("search_transactions", { query: "" })).toThrow();
    expect(() => run("get_category_totals", { month: "October" })).toThrow();
    expect(() => run("drop_tables", {})).toThrow(/Unknown tool/);
  });
});

describe("configuration", () => {
  it("encrypts the API key, never reports it, and keeps it when other fields change", () => {
    const db = freshDb();
    expect(getAiConfig(db)).toMatchObject({
      enabled: false,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "",
      hasKey: false,
    });
    const cfg = updateAiConfig(db, { apiKey: "sk-or-supersecretkey", model: "openai/gpt-4o-mini", enabled: true });
    expect(cfg).toMatchObject({ enabled: true, hasKey: true });
    expect(JSON.stringify(cfg)).not.toContain("supersecret");
    const stored = db.select().from(settings).where(eq(settings.key, "ai:api_key")).get()!.value;
    expect(stored).not.toContain("supersecret");
    expect(getApiKey(db)).toBe("sk-or-supersecretkey");
    updateAiConfig(db, { model: "openai/gpt-4o" });
    expect(getApiKey(db)).toBe("sk-or-supersecretkey");
    expect(updateAiConfig(db, { apiKey: null, enabled: false })).toMatchObject({ hasKey: false, enabled: false });
    expect(getApiKey(db)).toBeUndefined();
  });

  it("refuses to enable an unusable setup and validates fields", () => {
    const db = freshDb();
    expect(() => updateAiConfig(db, { enabled: true })).toThrow(/model name/); // the address is prefilled, the model isn't
    expect(() => updateAiConfig(db, { model: "m", baseUrl: "", enabled: true })).toThrow();
    expect(() => updateAiConfig(db, { enabled: true, model: "m", baseUrl: "http://x" })).not.toThrow(AiConfigError);
    expect(() => updateAiConfig(db, { baseUrl: "ftp://example.com" })).toThrow();
    expect(() => updateAiConfig(db, { apiKey: "short" })).toThrow();
    expect(() => updateAiConfig(db, { surprise: 1 })).toThrow();
    expect(updateAiConfig(db, { baseUrl: "http://localhost:3000/api", model: "llama3", enabled: true }).enabled).toBe(
      true,
    );
  });

  it("getLlm is null unless AI is on and complete", () => {
    const db = freshDb();
    expect(getLlm(db)).toBeNull();
    updateAiConfig(db, { apiKey: "sk-or-supersecretkey", model: "openai/gpt-4o-mini" });
    expect(getLlm(db)).toBeNull(); // saved but not enabled
    updateAiConfig(db, { enabled: true });
    expect(getLlm(db)).not.toBeNull();
    updateAiConfig(db, { enabled: false });
    expect(getLlm(db)).toBeNull();
  });
});

describe("monthly summary cache", () => {
  const env = (db: ReturnType<typeof freshDb>, llm: LlmClient, now = NOW) => ({
    db,
    llm,
    model: "m",
    includeBalances: false,
    now,
    timeZone: TZ,
  });

  it("is saved per month and replaced on regeneration", async () => {
    const { db } = dataset();
    expect(getCachedSummary(db, "2026-10")).toBeNull();
    await generateSummary(env(db, fakeLlm("first").client));
    expect(getCachedSummary(db, "2026-10")).toMatchObject({ text: "first", model: "m" });
    await generateSummary(env(db, fakeLlm("second").client, NOW + 60));
    expect(getCachedSummary(db, "2026-10")?.text).toBe("second");
    expect(db.select().from(insightsCache).all()).toHaveLength(1);
    expect(getCachedSummary(db, "2026-09")).toBeNull();
  });

  it("goes stale when a sync finishes afterwards", async () => {
    const { db } = dataset();
    await generateSummary(env(db, fakeLlm("hello").client));
    db.insert(syncRuns)
      .values({ startedAt: NOW - 100, finishedAt: NOW - 50, status: "ok" })
      .run();
    expect(getCachedSummary(db, "2026-10")?.text).toBe("hello"); // sync was before the summary
    db.insert(syncRuns)
      .values({ startedAt: NOW + 10, finishedAt: NOW + 20, status: "ok" })
      .run();
    expect(getCachedSummary(db, "2026-10")).toBeNull();
  });

  it("streams text through onText and does not cache a failed generation", async () => {
    const { db } = dataset();
    const chunks: string[] = [];
    await generateSummary(env(db, fakeLlm("streamed").client), (d) => chunks.push(d));
    expect(chunks.join("")).toBe("streamed");
    const failing: LlmClient = { generate: () => Promise.reject(new Error("boom")) };
    await expect(generateSummary(env(db, failing, NOW + 5))).rejects.toThrow("boom");
    expect(getCachedSummary(db, "2026-10")?.text).toBe("streamed");
  });
});

describe("dev logging", () => {
  it("prints the outgoing payload (and tool results) but not anything extra", async () => {
    const lines: unknown[][] = [];
    const logged = withDevLogging(fakeLlm().client, (...a) => lines.push(a));
    await logged.generate({ system: "sys", user: "hello", tools: [], runTool: () => "x" });
    expect(String(lines[0][1])).toContain('"user": "hello"');
  });
});

describe("OpenAI-compatible client", () => {
  afterEach(() => vi.unstubAllGlobals());

  const sse = (events: unknown[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const e of events)
            c.enqueue(new TextEncoder().encode(`data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`));
          c.close();
        },
      }),
      { status: 200 },
    );
  const chunk = (delta: unknown, finish: string | null = null) => ({ choices: [{ delta, finish_reason: finish }] });

  it("streams text and sends the key as a bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sse([chunk({ content: "Hel" }), chunk({ content: "lo" }, "stop"), "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createOpenAiCompatibleClient({
      apiKey: "k-123",
      model: "llama",
      baseUrl: "http://localhost:11434/v1/",
    });
    const seen: string[] = [];
    const text = await client.generate({ system: "s", user: "u", onText: (d) => seen.push(d) });
    expect(text).toBe("Hello");
    expect(seen).toEqual(["Hel", "lo"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.headers.authorization).toBe("Bearer k-123");
    expect(JSON.parse(init.body)).toMatchObject({ model: "llama", stream: true });
  });

  it("runs the tool loop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sse([
          chunk({
            tool_calls: [{ index: 0, id: "c1", function: { name: "get_category_totals", arguments: '{"mon' } }],
          }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: 'th":"2026-10"}' } }] }, "tool_calls"),
        ]),
      )
      .mockResolvedValueOnce(sse([chunk({ content: "Dining was high." }, "stop")]));
    vi.stubGlobal("fetch", fetchMock);
    const runTool = vi.fn().mockReturnValue('{"ok":true}');
    const client = createOpenAiCompatibleClient({ model: "m", baseUrl: "https://example.test/v1" });
    const text = await client.generate({
      system: "s",
      user: "u",
      tools: [{ name: "get_category_totals", description: "d", inputSchema: { type: "object", properties: {} } }],
      runTool,
    });
    expect(text).toBe("Dining was high.");
    expect(runTool).toHaveBeenCalledWith("get_category_totals", { month: "2026-10" });
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: '{"ok":true}' });
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined(); // no key, no header
  });

  it.each([
    [401, "auth"],
    [429, "rate_limit"],
    [404, "bad_response"],
    [500, "unavailable"],
  ])("maps HTTP %d to a friendly %s error", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status })));
    const client = createOpenAiCompatibleClient({
      apiKey: "key-should-not-leak",
      model: "m",
      baseUrl: "https://example.test/v1",
    });
    await expect(client.generate({ system: "s", user: "u" })).rejects.toMatchObject({
      kind,
      message: expect.not.stringContaining("key-should-not-leak"),
    });
  });

  it("reports an unreachable server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = createOpenAiCompatibleClient({ model: "m", baseUrl: "http://localhost:1/v1" });
    await expect(client.generate({ system: "s", user: "u" })).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("OpenAI-compatible token limit field", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries with max_completion_tokens when a server insists on it", async () => {
    const ok = () =>
      new Response(
        new ReadableStream({
          start: (c) => (
            c.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
              ),
            ),
            c.close()
          ),
        }),
        { status: 200 },
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"Unsupported parameter: use max_completion_tokens instead"}}', {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const text = await createOpenAiCompatibleClient({ model: "m", baseUrl: "https://openrouter.ai/api/v1" }).generate({
      system: "s",
      user: "u",
      maxTokens: 123,
    });
    expect(text).toBe("hi");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ max_tokens: 123 });
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(retry).toMatchObject({ max_completion_tokens: 123 });
    expect(retry.max_tokens).toBeUndefined();
  });

  it("does not retry other 400s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"bad model"}', { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createOpenAiCompatibleClient({ model: "m", baseUrl: "http://x/v1" }).generate({ system: "s", user: "u" }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAI-compatible servers without tool support", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("answers without lookups when the server rejects the tools parameter", async () => {
    const ok = () =>
      new Response(
        new ReadableStream({
          start: (c) => (
            c.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: "from the summary" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
              ),
            ),
            c.close()
          ),
        }),
        { status: 200 },
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"tools are not supported by this model"}', { status: 400 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const text = await createOpenAiCompatibleClient({ model: "tiny", baseUrl: "http://openwebui:3000/api" }).generate({
      system: "s",
      user: "u",
      tools: [{ name: "t", description: "d", inputSchema: { type: "object", properties: {} } }],
      runTool: () => "x",
    });
    expect(text).toBe("from the summary");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tools).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toBe("http://openwebui:3000/api/chat/completions");
  });
});

describe("usage", () => {
  afterEach(() => vi.unstubAllGlobals());

  const sse = (events: unknown[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const e of events)
            c.enqueue(new TextEncoder().encode(`data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`));
          c.close();
        },
      }),
      { status: 200 },
    );
  const text = (content: string) => ({ choices: [{ delta: { content }, finish_reason: "stop" }] });
  const usageChunk = {
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042, prompt_tokens_details: { cached_tokens: 100 } },
  };
  const client = () => createOpenAiCompatibleClient({ model: "m", baseUrl: "http://x/v1" });

  it("reports usage once per round, with cost in micro-dollars", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([text("hi"), usageChunk, "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const seen: unknown[] = [];
    await client().generate({ system: "s", user: "u", onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ promptTokens: 120, completionTokens: 30, cachedTokens: 100, costMicros: 420 }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
  });

  it("reports each round of a tool-using answer", async () => {
    const toolRound = {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "t", arguments: "{}" } }] },
          finish_reason: "tool_calls",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sse([toolRound, usageChunk, "[DONE]"]))
        .mockResolvedValueOnce(sse([text("done"), usageChunk, "[DONE]"])),
    );
    const onUsage = vi.fn();
    const out = await client().generate({ system: "s", user: "u", tools: [], runTool: () => "ok", onUsage });
    expect(out).toBe("done");
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the server sends no usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([text("hi"), "[DONE]"])));
    const onUsage = vi.fn();
    expect(await client().generate({ system: "s", user: "u", onUsage })).toBe("hi");
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("retries without stream_options when the server rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"unknown parameter stream_options"}', { status: 400 }))
      .mockResolvedValueOnce(sse([text("ok"), "[DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().generate({ system: "s", user: "u" })).toBe("ok");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stream_options).toBeUndefined();
  });
});

describe("tracked runs", () => {
  it("summary and ask still work through trackRuns and leave ai_runs rows", async () => {
    const { db } = dataset();
    const meta = { feature: "chat", model: "m", trigger: "manual" } as const;
    const tracked = trackRuns(db, fakeLlm("hello").client, meta, () => NOW);
    const env = { db, llm: tracked, model: "m", includeBalances: false, now: NOW, timeZone: TZ };
    expect((await generateSummary(env)).text).toBe("hello");
    expect(await answerQuestion(env, "How much did I spend?")).toBe("hello");
    expect(db.select().from(aiRuns).all()).toHaveLength(2);
  });
});
