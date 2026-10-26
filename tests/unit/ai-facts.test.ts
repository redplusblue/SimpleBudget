import { describe, expect, it } from "vitest";
import {
  collectFacts,
  factsForLens,
  factsForModel,
  goalFacts,
  merchantGrowthFacts,
  rulesCoverageFacts,
  savingsRateFacts,
  subscriptionFacts,
  targetFacts,
  upcomingBillFacts,
  MAX_FACTS,
} from "@/lib/ai/facts";
import { insertProposals } from "@/lib/ai/proposals";
import { zonedDayStart } from "@/lib/finance/dates";
import { createGoal } from "@/lib/finance/goals";
import { createTarget } from "@/lib/finance/targets";
import { createContext } from "@/lib/insights/data";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";
import { payload } from "../helpers/ai";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");
const env = { now: NOW, timeZone: TZ, includeBalances: false };

function setup() {
  const db = freshDb();
  addAccount(db, "A");
  const spend = (date: string, dollars: number, description: string, category?: number) =>
    addTxn(db, "A", { posted: at(date), amountCents: -Math.round(dollars * 100), description, categoryId: category });
  const earn = (date: string, dollars: number, description = "PAYROLL") =>
    addTxn(db, "A", { posted: at(date), amountCents: Math.round(dollars * 100), description });
  const ctx = () => createContext(db, NOW, TZ, "2026-10");
  return { db, spend, earn, ctx };
}

describe("merchantGrowthFacts", () => {
  it("flags a merchant at 1.5x its usual 30 days and $50 more", () => {
    const { spend, ctx } = setup();
    // Usual: 6 x $50 over the previous 180 days = $50 per 30 days. Now: $200.
    for (const d of ["2026-03-30", "2026-05-01", "2026-06-15", "2026-07-20", "2026-08-10", "2026-09-05"])
      spend(d, 50, "ACME GYM");
    spend("2026-10-10", 200, "ACME GYM");
    // Steady merchant: usual $50, now $60 (below 1.5x).
    for (const d of ["2026-03-30", "2026-05-01", "2026-06-15", "2026-07-20", "2026-08-10", "2026-09-05"])
      spend(d, 50, "STEADY CAFE");
    spend("2026-10-10", 60, "STEADY CAFE");
    // New merchant with no history is not "growth".
    spend("2026-10-12", 500, "BRAND NEW SHOP");
    const facts = merchantGrowthFacts(ctx());
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ id: "merchant-up:acmegym:2026-10", lenses: ["spending"], severity: "info" });
    expect(facts[0].detail).toBe("$200 in the last 30 days against about $50 in a typical 30 days.");
    expect(facts[0].link).toContain("/transactions");
  });
});

describe("subscriptions and upcoming bills", () => {
  it("totals the active recurring charges and lists those due within 7 days", () => {
    const { spend, ctx } = setup();
    for (const d of ["2026-07-27", "2026-08-27", "2026-09-27"]) spend(d, 15.99, "NETFLIX.COM");
    const subs = subscriptionFacts(ctx());
    expect(subs[0]).toMatchObject({ id: "subscriptions-total", title: "1 recurring charges cost $15.99 a month" });
    expect(subs[0].detail).toContain("NETFLIX.COM");
    const soon = upcomingBillFacts(ctx());
    expect(soon[0]).toMatchObject({ id: "upcoming-bills:2026-10-24", lenses: ["cashflow"] });
    expect(soon[0].title).toBe("1 bill due in the next 7 days ($15.99)");
    expect(soon[0].detail).toContain("2026-10-27");
  });

  it("is quiet without recurring charges", () => {
    const { ctx } = setup();
    expect(subscriptionFacts(ctx())).toEqual([]);
    expect(upcomingBillFacts(ctx())).toEqual([]);
  });
});

describe("savingsRateFacts", () => {
  it("compares the last 3 full months with the 3 before", () => {
    const { db, spend, earn } = setup();
    for (const m of ["2026-07", "2026-08", "2026-09"]) {
      earn(`${m}-05`, 1000);
      spend(`${m}-10`, 500, "RENT");
    }
    for (const m of ["2026-04", "2026-05", "2026-06"]) {
      earn(`${m}-05`, 1000);
      spend(`${m}-10`, 800, "RENT");
    }
    const [f] = savingsRateFacts(db, env);
    expect(f).toMatchObject({
      id: "savings-rate:2026-10",
      severity: "good",
      title: "Your savings rate improved to 50%",
    });
    expect(f.detail).toContain("against 20%");
  });

  it("skips small changes", () => {
    const { db, spend, earn } = setup();
    for (const m of ["2026-07", "2026-08", "2026-09", "2026-04", "2026-05", "2026-06"]) {
      earn(`${m}-05`, 1000);
      spend(`${m}-10`, 500, "RENT");
    }
    expect(savingsRateFacts(db, env)).toEqual([]);
  });
});

describe("targets, goals and rules coverage", () => {
  it("reports a target that is over, and one on pace to pass", () => {
    const { db, spend } = setup();
    const dining = categoryId(db, "Dining");
    const groceries = categoryId(db, "Groceries");
    createTarget(db, { kind: "category", subjectId: dining, amountCents: 10_000 });
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 100_000 });
    spend("2026-10-05", 120, "RESTAURANT", dining);
    spend("2026-10-06", 500, "MARKET", groceries); // 500 over 24 days -> ~620 projected, under 1000
    const facts = targetFacts(db, env);
    expect(facts.map((f) => f.id)).toEqual([`target-over:${1}:2026-10`]);
    expect(facts[0]).toMatchObject({ severity: "warn", title: "Dining is over its target" });
    expect(facts[0].detail).toBe("$120 spent against a $100 target this month.");
  });

  it("celebrates a reached goal, with a redacted wording for the model", () => {
    const { db } = setup();
    addAccount(db, "S", { type: "savings", balanceCents: 500_000, name: "Rainy day fund" });
    createGoal(db, { name: "Emergency", accountId: "S", targetCents: 400_000 });
    const [f] = goalFacts(db, env);
    expect(f).toMatchObject({ id: "goal-done:1", severity: "good", sensitive: true });
    expect(f.detail).toContain("$4,000");
    expect(f.redacted?.detail).not.toContain("$");
  });

  it("counts categorized share and pending suggestions", () => {
    const { db, spend } = setup();
    const dining = categoryId(db, "Dining");
    spend("2026-10-01", 5, "A", dining);
    spend("2026-10-02", 5, "B", dining);
    spend("2026-10-03", 5, "C", dining);
    spend("2026-10-04", 5, "D");
    insertProposals(db, [
      {
        kind: "rule",
        source: "rules_job",
        subjectKey: "category:x",
        payloadJson: JSON.stringify(payload()),
        createdAt: 1,
      },
    ]);
    const [f] = rulesCoverageFacts(db, env);
    expect(f.title).toBe("75% of recent transactions are categorized");
    expect(f.detail).toBe(
      "1 of the last 90 days' transactions still need a category, and 1 rule suggestion is waiting.",
    );
    expect(f.link).toBe("/rules");
  });
});

describe("collectFacts and factsForModel", () => {
  function accountsSetup() {
    const s = setup();
    addAccount(s.db, "jar", {
      isManual: true,
      displayName: "Secret Cash Jar",
      balanceCents: 123_456,
      createdAt: at("2026-08-01"),
    });
    addAccount(s.db, "low", { balanceCents: 1_000, lowBalanceCents: 50_000, displayName: "Everyday" });
    return s;
  }

  it("redacts sensitive facts unless balances are shared", () => {
    const { db } = accountsSetup();
    const facts = collectFacts(db, env);
    const hidden = JSON.stringify(factsForModel(facts, false));
    expect(hidden).not.toContain("Secret Cash Jar");
    expect(hidden).not.toContain("Everyday");
    expect(hidden).toContain("One of your manual accounts hasn't been updated in 84 days");
    const shown = JSON.stringify(factsForModel(facts, true));
    expect(shown).toContain("Secret Cash Jar");
    expect(shown).toContain("Everyday is running low");
  });

  it("puts warnings first and filters by lens", () => {
    const { db } = accountsSetup();
    const facts = collectFacts(db, env);
    expect(facts[0].severity).toBe("warn");
    expect(factsForLens(facts, "accounts").every((f) => f.lenses.includes("accounts"))).toBe(true);
    expect(factsForLens(facts, "all")).toHaveLength(facts.length);
  });

  it("is capped", () => {
    const { db } = setup();
    for (let i = 0; i < MAX_FACTS + 10; i++) addAccount(db, `m${i}`, { isManual: true, createdAt: at("2026-01-01") });
    expect(collectFacts(db, env)).toHaveLength(MAX_FACTS);
  });
});
