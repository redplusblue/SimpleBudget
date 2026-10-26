import { afterEach, describe, expect, it, vi } from "vitest";
import { benchmarkFacts, getBenchmarks, parseResearch, safeCitations, topicsForLens } from "@/lib/ai/web-research";
import { addMemory } from "@/lib/ai/memory";
import { updateAiConfig } from "@/lib/llm/config";
import type { FeatureLlm } from "@/lib/llm";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const NOW = 1_760_000_000;
const ANSWER = JSON.stringify([
  { id: "savings-rate", value: "4.6% of disposable income", year: 2025, source: "BEA" },
  { id: "emergency-fund", value: "3 to 6 months", source: "CFPB" },
  { id: "not-a-topic", value: "x", source: "y" },
]);

function setup(webSearch = true, profile = { country: "US" } as { country: string; ageRange?: "30-39" }) {
  const db = freshDb();
  const requests: GenerateRequest[] = [];
  const llm: LlmClient = {
    async generate(req) {
      requests.push(req);
      req.onAnnotations?.([
        { url: "https://www.bea.gov/data", title: "BEA data" },
        { url: "http://insecure.example/x", title: "Insecure" },
        { url: "javascript:alert(1)" },
      ]);
      return `Here you go ${ANSWER} see https://model-made-up.example`;
    },
  };
  const picked: FeatureLlm = { llm, model: "m", entry: undefined };
  const getLlm = vi.fn(() => picked);
  const env = { db, cfg: { webSearch, profile }, now: NOW, timeZone: "UTC", getLlm };
  return { db, env, requests, getLlm };
}

afterEach(() => vi.unstubAllGlobals());

describe("getBenchmarks", () => {
  it("does nothing, and makes no request of any kind, while web research is off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env, getLlm, requests } = setup(false);
    expect(await getBenchmarks(env, "all")).toEqual([]);
    expect(getLlm).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("researches the lens's topics in one call, keeps valid answers and https sources only", async () => {
    const { env, requests } = setup();
    const got = await getBenchmarks(env, "cashflow");
    expect(requests).toHaveLength(1);
    expect(requests[0].extraBody).toEqual({ plugins: [{ id: "web", max_results: 5 }] });
    expect(got.map((b) => b.id)).toEqual(["savings-rate", "emergency-fund"]);
    expect(got[0]).toMatchObject({ value: "4.6% of disposable income", year: 2025, source: "BEA" });
    expect(got[0].sources).toEqual([{ url: "https://www.bea.gov/data", title: "BEA data" }]);
    expect(JSON.stringify(got)).not.toContain("model-made-up"); // links only come from the provider's annotations
    expect(JSON.stringify(got)).not.toContain("insecure");
  });

  it("uses the cache for 30 days, and refetches when the profile changes", async () => {
    const { env, requests } = setup();
    await getBenchmarks(env, "cashflow");
    const again = await getBenchmarks({ ...env, now: NOW + 29 * 86_400 }, "cashflow");
    expect(requests).toHaveLength(1);
    expect(again).toHaveLength(2);
    await getBenchmarks({ ...env, now: NOW + 31 * 86_400 }, "cashflow");
    expect(requests).toHaveLength(2);
    await getBenchmarks({ ...env, cfg: { webSearch: true, profile: { country: "Canada" } } }, "cashflow");
    expect(requests).toHaveLength(3);
  });

  it("sends a fixed generic question: no amounts, merchants, memories or accounts", async () => {
    const { db, env, requests } = setup(true, { country: "US", ageRange: "30-39" });
    addAccount(db, "ACT-secret", { name: "Secret Checking", balanceCents: 123_456_00 });
    addTxn(db, "ACT-secret", { description: "SECRET MERCHANT STORE", amountCents: -98_765 });
    addMemory(db, "my secret memory text", "user", 1);
    updateAiConfig(db, { userName: "Samantha" });
    await getBenchmarks(env, "all");
    const wire = JSON.stringify(requests);
    for (const secret of [
      "SECRET MERCHANT",
      "Secret Checking",
      "ACT-secret",
      "987",
      "1234",
      "secret memory",
      "Samantha",
    ])
      expect(wire).not.toContain(secret);
    expect(wire).toContain("aged 30-39");
    expect(wire).toContain("in US");
  });

  it("respects the budget (cached results still work) and never throws", async () => {
    const { db, env, requests } = setup();
    await getBenchmarks(env, "cashflow");
    updateAiConfig(db, { model: "m", monthlyBudgetMicros: 0 });
    const cached = await getBenchmarks({ ...env, now: NOW + 40 * 86_400 }, "cashflow"); // stale cache + no budget
    expect(cached).toEqual([]);
    expect(requests).toHaveLength(1);
    const broken = setup();
    broken.env.getLlm.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await getBenchmarks(broken.env, "all")).toEqual([]);
  });
});

describe("helpers", () => {
  it("picks topics per lens, and 'all' or 'general' means every topic", () => {
    expect(topicsForLens("cashflow")).toEqual(["savings-rate", "emergency-fund"]);
    expect(topicsForLens("goals")).toEqual(["retirement-balance"]);
    expect(topicsForLens("subscriptions")).toEqual([]);
    expect(topicsForLens("all")).toHaveLength(5);
    expect(topicsForLens("general")).toHaveLength(5);
  });

  it("parses tolerantly and de-duplicates", () => {
    expect(parseResearch("```json\n" + ANSWER + "\n```", ["savings-rate"])).toHaveLength(1);
    expect(parseResearch("no json", ["savings-rate"])).toEqual([]);
    expect(
      parseResearch(
        JSON.stringify([
          { id: "savings-rate", value: "a", source: "b" },
          { id: "savings-rate", value: "c", source: "d" },
        ]),
        ["savings-rate"],
      ),
    ).toHaveLength(1);
  });

  it("keeps only https citations, normalized and capped", () => {
    expect(
      safeCitations([
        { url: "https://a.example/x" },
        { url: "https://a.example/x" },
        { url: "http://b.example" },
        { url: "not a url" },
        ...Array.from({ length: 10 }, (_, i) => ({ url: `https://c.example/${i}` })),
      ]),
    ).toHaveLength(5);
  });

  it("turns benchmarks into facts that carry their sources", () => {
    const [f] = benchmarkFacts([
      {
        id: "savings-rate",
        label: "Average personal savings rate",
        value: "4.6%",
        year: 2025,
        source: "BEA",
        sources: [{ url: "https://x.example" }],
      },
    ]);
    expect(f).toMatchObject({
      id: "benchmark:savings-rate",
      lenses: ["cashflow"],
      title: "Public data: Average personal savings rate",
      detail: "4.6% (BEA, 2025).",
      sources: [{ url: "https://x.example" }],
    });
  });
});
