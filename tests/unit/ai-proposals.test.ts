import { describe, expect, it } from "vitest";
import { aiProposals } from "@/db/schema";
import {
  dismissProposal,
  forgetProposal,
  getProposal,
  hasProposalFor,
  insertProposals,
  listProposals,
  ProposalError,
} from "@/lib/ai/proposals";
import type { RuleProposalPayload } from "@/lib/ai/proposal-types";
import { freshDb } from "../helpers/db";

export const payload = (name = "Blue Bottle Coffee"): RuleProposalPayload => ({
  merchant: {
    key: "expense:bluebottlecoffee",
    name,
    sample: "SQ *BLUE BOTTLE #1",
    direction: "expense",
    count: 3,
    medianCents: 500,
  },
  action: { type: "category", categoryId: 1, categoryName: "Dining" },
  pattern: { op: "equals", value: name },
  target: { mode: "new", ruleName: "AI · Dining" },
});

const row = (subjectKey: string, over: Partial<typeof aiProposals.$inferInsert> = {}) => ({
  kind: "rule" as const,
  source: "rules_job" as const,
  subjectKey,
  payloadJson: JSON.stringify(payload()),
  createdAt: 1000,
  ...over,
});

describe("proposal store", () => {
  it("round-trips and lists newest first", () => {
    const db = freshDb();
    insertProposals(db, [row("category:a", { confidence: "high" }), row("category:b", { createdAt: 2000 })]);
    const list = listProposals(db, { status: "pending" });
    expect(list.map((p) => p.row.subjectKey)).toEqual(["category:b", "category:a"]);
    expect(list[1].payload.merchant.name).toBe("Blue Bottle Coffee");
    expect(getProposal(db, list[0].row.id).row.id).toBe(list[0].row.id);
  });

  it("knows which merchants were already asked about", () => {
    const db = freshDb();
    insertProposals(db, [
      row("category:p", { status: "pending" }),
      row("category:d", { status: "dismissed" }),
      row("category:n", { status: "no_match" }),
      row("category:s", { status: "stale" }),
      row("category:a", { status: "accepted" }),
    ]);
    expect(
      hasProposalFor(db, ["category:p", "category:d", "category:n", "category:s", "category:a", "category:x"]),
    ).toEqual(new Set(["category:p", "category:d", "category:n"]));
  });

  it("dismisses, then forgets", () => {
    const db = freshDb();
    insertProposals(db, [row("category:a")]);
    const id = listProposals(db)[0].row.id;
    expect(() => forgetProposal(db, id)).toThrow(/Only dismissed/);
    dismissProposal(db, id, 5000);
    expect(getProposal(db, id).row).toMatchObject({ status: "dismissed", resolvedAt: 5000 });
    expect(() => dismissProposal(db, id, 6000)).toThrow(ProposalError);
    forgetProposal(db, id);
    expect(hasProposalFor(db, ["category:a"]).size).toBe(0);
  });

  it("throws not_found for unknown ids and skips corrupt rows", () => {
    const db = freshDb();
    expect(() => getProposal(db, 99)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => dismissProposal(db, 99, 1)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => forgetProposal(db, 99)).toThrow(expect.objectContaining({ code: "not_found" }));
    insertProposals(db, [row("category:ok"), row("category:bad", { payloadJson: "{nope" })]);
    expect(listProposals(db).map((p) => p.row.subjectKey)).toEqual(["category:ok"]);
  });
});
