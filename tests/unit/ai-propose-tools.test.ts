import { describe, expect, it } from "vitest";
import { createProposeRunner, PROPOSE_TOOLS } from "@/lib/ai/propose-tools";
import { acceptProposal, listProposals, listThreadProposals } from "@/lib/ai/proposals";
import { listMemories } from "@/lib/ai/memory";
import type { AnyProposalView } from "@/lib/ai/proposal-types";
import { listTargets } from "@/lib/finance/targets";
import { zonedDayStart } from "@/lib/finance/dates";
import { LLM_TOOLS, createToolRunner } from "@/lib/llm/tools";
import { MCP_TOOLS } from "@/lib/mcp/server";
import { listRules } from "@/lib/rules/store";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const NOW = zonedDayStart("2026-10-24", "UTC") + 12 * 3600;

function setup() {
  const db = freshDb();
  addAccount(db, "a1");
  for (let i = 1; i <= 3; i++) addTxn(db, "a1", { description: `SQ *BLUE BOTTLE COFFEE #${i}`, amountCents: -500 });
  const seen: AnyProposalView[] = [];
  const run = createProposeRunner(db, { threadId: 7, model: "m", runId: () => null, now: NOW, timeZone: "UTC" }, (p) =>
    seen.push(p),
  );
  return { db, run, seen };
}

describe("propose_rule", () => {
  it("creates a pending, thread-tied proposal that applies through the normal rule code", () => {
    const { db, run, seen } = setup();
    const text = run("propose_rule", { payee: "blue bottle", category: "dining" });
    expect(text).toMatch(
      /^Proposal created: new rule for payee is "BLUE BOTTLE COFFEE" → Dining \(matches 3, fills 3\)/,
    );
    expect(text).toContain("Do not claim it is applied");
    expect(seen).toHaveLength(1);
    const [p] = listProposals(db, { status: "pending" });
    expect(p.row).toMatchObject({ source: "assistant", threadId: 7, kind: "rule", model: "m" });
    expect(seen[0]).toMatchObject({ kind: "rule", threadId: 7, id: p.row.id });
    expect(listThreadProposals(db, 7, "UTC")).toHaveLength(1);

    const r = acceptProposal(db, p.row.id, { applyExisting: true }, NOW);
    expect(r).toMatchObject({ kind: "rule", mode: "new", categorized: 3 });
    expect(listRules(db)).toHaveLength(1);
  });

  it("returns readable errors and creates nothing", () => {
    const { db, run } = setup();
    expect(run("propose_rule", { payee: "blue bottle", category: "Nope" })).toMatch(/No category named "Nope"/);
    expect(run("propose_rule", { payee: "zzzz", category: "Dining" })).toMatch(/No transactions match "zzzz"/);
    expect(run("propose_rule", { payee: "", category: "Dining" })).toMatch(/^Invalid input/);
    expect(listProposals(db)).toHaveLength(0);
  });
});

describe("propose_memory and propose_target", () => {
  it("memory proposals write a memory only when accepted", () => {
    const { db, run, seen } = setup();
    expect(run("propose_memory", { text: "Rent is paid to Acme" })).toContain('remember "Rent is paid to Acme"');
    expect(listMemories(db)).toHaveLength(0);
    const id = seen[0].id;
    expect(acceptProposal(db, id, { applyExisting: true }, NOW)).toMatchObject({ kind: "memory" });
    expect(listMemories(db)).toMatchObject([{ text: "Rent is paid to Acme", source: "assistant" }]);
    expect(() => acceptProposal(db, id, { applyExisting: true }, NOW)).toThrow(/already handled/);
    expect(run("propose_memory", { text: "hi" })).toMatch(/^Invalid input/);
  });

  it("target proposals create a recurring category target when accepted", () => {
    const { db, run, seen } = setup();
    expect(run("propose_target", { category: "Dining", monthly_amount: 250.5 })).toContain("$250.50");
    expect(run("propose_target", { category: "Nope", monthly_amount: 5 })).toMatch(/No category/);
    expect(run("propose_target", { category: "Dining", monthly_amount: 0 })).toMatch(/^Invalid input/);
    const r = acceptProposal(db, seen[0].id, { applyExisting: true }, NOW);
    expect(r.kind).toBe("target");
    expect(listTargets(db)).toMatchObject([
      { kind: "category", subjectId: categoryId(db, "Dining"), amountCents: 25_050, month: null },
    ]);
    expect(run("propose_target", { category: "Dining", monthly_amount: 100 })).toMatch(/already exists/);
  });
});

describe("tool separation and read tools", () => {
  it("never exposes propose tools to the MCP server or the read tools", () => {
    const names = Object.keys(PROPOSE_TOOLS);
    for (const n of names) {
      expect(MCP_TOOLS.some((t) => t.name === n)).toBe(false);
      expect(LLM_TOOLS.some((t) => t.name === n)).toBe(false);
    }
  });

  it("get_facts honours the balances opt-in and get_goals hides balances", () => {
    const db = freshDb();
    addAccount(db, "jar", { isManual: true, displayName: "Secret Cash Jar", createdAt: NOW - 90 * 86_400 });
    const off = createToolRunner(db, NOW, "UTC", false)("get_facts", {});
    expect(off).not.toContain("Secret Cash Jar");
    expect(off).toContain("manual account");
    expect(createToolRunner(db, NOW, "UTC", true)("get_facts", { lens: "accounts" })).toContain("Secret Cash Jar");
    expect(createToolRunner(db, NOW, "UTC")("get_goals", {})).toBe('{"goals":[]}');
    expect(() => createToolRunner(db, NOW, "UTC")("get_facts", { lens: "bogus" })).toThrow();
  });
});
