import { beforeEach, describe, expect, it } from "vitest";
import { clearSearchCache, mapReply, parseReply, plainEnglishFilters } from "@/lib/ai/nl-search";
import { zonedDayStart } from "@/lib/finance/dates";
import type { GenerateRequest, LlmClient } from "@/lib/llm/types";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const NOW = zonedDayStart("2026-10-24", "UTC") + 12 * 3600;
beforeEach(() => clearSearchCache());

function setup() {
  const db = freshDb();
  addAccount(db, "ACT-secret", { name: "Secret Checking", displayName: "Everyday" });
  addTxn(db, "ACT-secret", { description: "PRIVATE MERCHANT 123", notes: "private note", amountCents: -4242 });
  const tag = addTag(db, "Vacation");
  return { db, dining: categoryId(db, "Dining"), tag };
}
function fake(answer: string) {
  const requests: GenerateRequest[] = [];
  const llm: LlmClient = {
    async generate(req) {
      requests.push(req);
      return answer;
    },
  };
  return { llm, requests };
}
const env = (db: ReturnType<typeof freshDb>, llm: LlmClient) => ({ db, llm, now: NOW, timeZone: "UTC" });

describe("mapReply", () => {
  const lookup = { categories: [{ id: 5, name: "Dining" }], tags: [{ id: 9, name: "Vacation" }] };

  it("maps names to ids, dollars to cents, and keeps valid dates", () => {
    const r = mapReply(
      {
        q: "coffee",
        from: "2026-03-01",
        to: "2026-05-31",
        category: "dining",
        tag: "VACATION",
        minAmount: 12.5,
        maxAmount: 100,
        type: "expense",
      },
      lookup,
    );
    expect(r).toEqual({
      filters: {
        q: "coffee",
        from: "2026-03-01",
        to: "2026-05-31",
        categoryId: 5,
        tagId: 9,
        minAmountCents: 1250,
        maxAmountCents: 10_000,
        type: "expense",
      },
      dropped: [],
    });
  });

  it("drops unknown categories and tags and bad dates, and says so", () => {
    const r = mapReply({ category: "Spaceships", tag: "Nope", from: "last spring", to: "2026-02-31" }, lookup);
    expect(r.filters).toEqual({});
    expect(r.dropped).toEqual([
      'category "Spaceships"',
      'tag "Nope"',
      'start date "last spring"',
      'end date "2026-02-31"',
    ]);
  });

  it("understands uncategorized, and puts reversed ranges in order", () => {
    expect(mapReply({ category: "Uncategorized" }, lookup).filters.categoryId).toBe("none");
    expect(mapReply({ from: "2026-05-01", to: "2026-03-01", minAmount: 50, maxAmount: 10 }, lookup).filters).toEqual({
      from: "2026-03-01",
      to: "2026-05-01",
      minAmountCents: 1000,
      maxAmountCents: 5000,
    });
  });
});

describe("parseReply", () => {
  it("is tolerant of fences and chatter, and rejects nonsense", () => {
    expect(parseReply('Sure!\n```json\n{"q":"uber","type":"expense"}\n```')).toEqual({ q: "uber", type: "expense" });
    expect(parseReply("no json here")).toBeNull();
    expect(parseReply('{"type":"banana"}')).toBeNull();
    expect(parseReply('{"minAmount":-5}')).toBeNull();
  });
});

describe("plainEnglishFilters", () => {
  it("sends only the question, today's date and category/tag names, never transactions or accounts", async () => {
    const { db, dining } = setup();
    const { llm, requests } = fake(
      JSON.stringify({ q: "coffee", category: "Dining", minAmount: 5, from: "2026-03-01" }),
    );
    const r = await plainEnglishFilters(env(db, llm), "coffee over $5 since March");
    expect(r?.filters).toMatchObject({ q: "coffee", categoryId: dining, minAmountCents: 500, from: "2026-03-01" });
    const wire = JSON.stringify(requests);
    expect(wire).toContain("Today is 2026-10-24");
    expect(wire).toContain("Dining");
    expect(wire).toContain("Vacation");
    for (const secret of [
      "PRIVATE MERCHANT",
      "private note",
      "ACT-secret",
      "Secret Checking",
      "Everyday",
      "4242",
      "42.42",
    ])
      expect(wire).not.toContain(secret);
  });

  it("answers an identical question from memory the same day, but not the next day", async () => {
    const { db } = setup();
    const { llm, requests } = fake('{"q":"uber"}');
    await plainEnglishFilters(env(db, llm), "uber rides");
    await plainEnglishFilters(env(db, llm), "  Uber rides ");
    expect(requests).toHaveLength(1);
    await plainEnglishFilters({ ...env(db, llm), now: NOW + 86_400 }, "uber rides");
    expect(requests).toHaveLength(2);
  });

  it("returns null when the answer can't be used, and doesn't remember it", async () => {
    const { db } = setup();
    const { llm, requests } = fake("I'm not sure");
    expect(await plainEnglishFilters(env(db, llm), "huh")).toBeNull();
    await plainEnglishFilters(env(db, llm), "huh");
    expect(requests).toHaveLength(2);
  });
});
