import { describe, expect, it } from "vitest";
import { aiRuns } from "@/db/schema";
import { updateAiConfig } from "@/lib/llm/config";
import { assertWithinBudget, monthSpendMicros, trackRuns, usageReport } from "@/lib/llm/runs";
import { LlmError, type GenerateRequest, type LlmClient, type LlmUsage } from "@/lib/llm/types";
import { freshDb } from "../helpers/db";

const NOW = 1_760_000_000; // mid October 2025
const rounds = (...us: LlmUsage[]): LlmClient => ({
  async generate(req: GenerateRequest) {
    us.forEach((u) => req.onUsage?.(u));
    return "answer";
  },
});
const u = (cost: number | null): LlmUsage => ({
  promptTokens: 1000,
  completionTokens: 500,
  cachedTokens: 10,
  costMicros: cost,
});
const meta = { feature: "chat", model: "m", trigger: "manual" } as const;

describe("trackRuns", () => {
  it("writes a row with usage summed over rounds", async () => {
    const db = freshDb();
    const seen: LlmUsage[] = [];
    const client = trackRuns(db, rounds(u(100), u(50)), meta, () => NOW);
    expect(await client.generate({ system: "s", user: "u", onUsage: (x) => seen.push(x) })).toBe("answer");
    expect(seen).toHaveLength(2);
    const row = db.select().from(aiRuns).get()!;
    expect(row).toMatchObject({
      status: "ok",
      promptTokens: 2000,
      completionTokens: 1000,
      cachedTokens: 20,
      costMicros: 150,
      costEstimated: false,
    });
    expect(client.lastRunId()).toBe(row.id);
  });

  it("records failures and rethrows", async () => {
    const db = freshDb();
    const client = trackRuns(
      db,
      {
        generate: async () => {
          throw new LlmError("x", "rate_limit");
        },
      },
      meta,
      () => NOW,
    );
    await expect(client.generate({ system: "s", user: "u" })).rejects.toThrow("x");
    expect(db.select().from(aiRuns).get()).toMatchObject({ status: "error", errorKind: "rate_limit" });
  });

  it("prefers reported cost, estimates from prices, else leaves null", async () => {
    const db = freshDb();
    const entry = { id: "m", inputPerMTok: 1, outputPerMTok: 2 };
    await trackRuns(db, rounds(u(7)), { ...meta, entry }, () => NOW).generate({ system: "s", user: "u" });
    await trackRuns(db, rounds(u(null)), { ...meta, entry }, () => NOW).generate({ system: "s", user: "u" });
    await trackRuns(db, rounds(u(null)), meta, () => NOW).generate({ system: "s", user: "u" });
    const rows = db.select().from(aiRuns).all();
    expect(rows.map((r) => [r.costMicros, r.costEstimated])).toEqual([
      [7, false],
      [2000, true], // 1000 * 1 + 500 * 2
      [null, false],
    ]);
  });
});

describe("budget", () => {
  const seed = (db: ReturnType<typeof freshDb>, startedAt: number, costMicros: number) =>
    db
      .insert(aiRuns)
      .values({ ...meta, status: "ok", startedAt, costMicros })
      .run();

  it("counts only this month", () => {
    const db = freshDb();
    seed(db, NOW, 300);
    seed(db, NOW - 40 * 86_400, 9_999);
    expect(monthSpendMicros(db, NOW, "UTC")).toBe(300);
    const report = usageReport(db, NOW, "UTC");
    expect(report.byFeature).toEqual([{ feature: "chat", runs: 1, costMicros: 300, tokens: 0 }]);
    expect(report.recent).toHaveLength(2);
  });

  it("refuses at or over budget, allows under, no cap, and 0 pauses", () => {
    const db = freshDb();
    updateAiConfig(db, { model: "m" });
    seed(db, NOW, 4_970_000);
    assertWithinBudget(db, NOW, "UTC");
    updateAiConfig(db, { monthlyBudgetMicros: 5_000_000 });
    assertWithinBudget(db, NOW, "UTC");
    updateAiConfig(db, { monthlyBudgetMicros: 4_970_000 });
    expect(() => assertWithinBudget(db, NOW, "UTC")).toThrow(/\$4\.97 of \$4\.97/);
    updateAiConfig(db, { monthlyBudgetMicros: 0 });
    expect(() => assertWithinBudget(freshDbWithBudget0(), NOW, "UTC")).toThrow(LlmError);
  });
});

function freshDbWithBudget0() {
  const db = freshDb();
  updateAiConfig(db, { monthlyBudgetMicros: 0 });
  return db;
}
