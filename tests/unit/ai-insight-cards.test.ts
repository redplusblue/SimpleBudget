import { describe, expect, it } from "vitest";
import { generateInsightCards, listInsightCards, parseCards, updateInsightCard } from "@/lib/ai/insight-cards";
import { addMemory } from "@/lib/ai/memory";
import { zonedDayStart } from "@/lib/finance/dates";
import { getAiConfig, updateAiConfig } from "@/lib/llm/config";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { addAccount, freshDb } from "../helpers/db";

const NOW = zonedDayStart("2026-10-24", "UTC") + 12 * 3600;

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
const env = (db: ReturnType<typeof freshDb>, llm: LlmClient, over = {}) => ({
  db,
  llm,
  model: "m",
  now: NOW,
  timeZone: "UTC",
  includeBalances: false,
  ...over,
});
const factIds = (req: GenerateRequest) => [...req.user.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);

function withStaleAccount() {
  const db = freshDb();
  addAccount(db, "jar", {
    isManual: true,
    displayName: "Secret Cash Jar",
    balanceCents: 777_00,
    createdAt: NOW - 70 * 86_400,
  });
  return db;
}

describe("generateInsightCards", () => {
  it("makes no model call when there are no facts", async () => {
    const { llm, requests } = fake(() => "[]");
    expect(await generateInsightCards(env(freshDb(), llm), { lens: "all" })).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("turns a valid answer into stored cards whose links come from the cited facts", async () => {
    const db = withStaleAccount();
    const { llm } = fake((req) =>
      JSON.stringify([
        {
          facts: [factIds(req).find((i) => i.startsWith("stale-manual:"))],
          severity: "warn",
          title: "A manual account is out of date",
          body: "It has not been updated in 70 days.",
          link: "https://evil.example", // ignored: links are never taken from model output
        },
      ]),
    );
    const cards = await generateInsightCards(env(db, llm, { userName: "Sam" }), { lens: "accounts" });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ severity: "warn", link: "/accounts/jar", lens: "accounts", batch: 1 });
    expect(listInsightCards(db)).toHaveLength(1);
    const second = await generateInsightCards(env(db, llm), { lens: "accounts" });
    expect(second[0].batch).toBe(2);
  });

  it("drops cards that cite no known fact, clamps lengths and caps the count", () => {
    const known = new Set(["a", "b"]);
    const text = JSON.stringify([
      { facts: ["zzz"], title: "Unknown", body: "x" },
      { facts: ["a"], severity: "weird", title: "T".repeat(200), body: "B".repeat(500) },
      { facts: ["b"], title: "Two", body: "two" },
      { facts: ["a"], title: "Three", body: "three" },
    ]);
    const cards = parseCards(text, known, 2);
    expect(cards).toHaveLength(2);
    expect(cards[0].severity).toBe("info");
    expect(cards[0].title.length).toBeLessThanOrEqual(80);
    expect(cards[0].body.length).toBeLessThanOrEqual(300);
    expect(parseCards("nonsense", known, 4)).toEqual([]);
  });

  it("sends no account name or balance when balances are off, and includes memories and the name", async () => {
    const db = withStaleAccount();
    addMemory(db, "Rent is paid to Acme", "user", 1);
    const { llm, requests } = fake(() => "[]");
    await generateInsightCards(env(db, llm, { userName: "Sam" }), { lens: "all" });
    const wire = JSON.stringify(requests);
    expect(wire).not.toContain("Secret Cash Jar");
    expect(wire).not.toContain("777");
    expect(wire).toContain("Rent is paid to Acme");
    expect(wire).toContain("Hey Sam");
    const on = fake(() => "[]");
    await generateInsightCards(env(db, on.llm, { includeBalances: true }), { lens: "all" });
    expect(JSON.stringify(on.requests)).toContain("Secret Cash Jar");
  });

  it("keeps the system prompt identical between requests", async () => {
    const db = withStaleAccount();
    const { llm, requests } = fake(() => "[]");
    await generateInsightCards(env(db, llm, { userName: "Sam" }), { lens: "all", count: 2 });
    await generateInsightCards(env(db, llm, { now: NOW + 40 * 86_400 }), { lens: "all", count: 5 });
    expect(requests[0].system).toBe(requests[1].system);
  });
});

describe("card state and the name setting", () => {
  it("pins and dismisses cards", async () => {
    const db = withStaleAccount();
    const { llm } = fake((req) =>
      JSON.stringify(
        factIds(req)
          .slice(0, 2)
          .map((id, i) => ({ facts: [id], title: `T${i}`, body: "b" })),
      ),
    );
    const cards = await generateInsightCards(env(db, llm), { lens: "all" });
    expect(cards.length).toBeGreaterThan(0);
    updateInsightCard(db, cards[0].id, { pinned: true }, NOW);
    expect(listInsightCards(db)[0].pinned).toBe(true);
    updateInsightCard(db, cards[0].id, { dismissed: true }, NOW);
    expect(listInsightCards(db).some((c) => c.id === cards[0].id)).toBe(false);
    expect(updateInsightCard(db, 999, { pinned: true }, NOW)).toBeNull();
  });

  it("stores the first name", () => {
    const db = freshDb();
    expect(updateAiConfig(db, { userName: " Sam " }).userName).toBe("Sam");
    expect(updateAiConfig(db, { userName: "" }).userName).toBe("");
    expect(getAiConfig(db).userName).toBe("");
  });
});
