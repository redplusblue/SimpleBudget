import { describe, expect, it } from "vitest";
import { aiProposals, transactionSplits, transactions } from "@/db/schema";
import {
  acceptAll,
  acceptRuleProposal,
  dismissProposal,
  forgetProposal,
  getProposal,
  hasProposalFor,
  insertProposals,
  listProposals,
  ProposalError,
} from "@/lib/ai/proposals";
import { payload } from "../helpers/ai";
import { listRules } from "@/lib/rules/store";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

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

describe("accepting", () => {
  function setup() {
    const db = freshDb();
    addAccount(db, "a1");
    const dining = categoryId(db, "Dining");
    const groceries = categoryId(db, "Groceries");
    const mk = (name: string, cat: number, catName: string, confidence: "low" | "medium" | "high", key = name) => {
      const p = payload(name);
      p.action = { type: "category", categoryId: cat, categoryName: catName };
      insertProposals(db, [
        {
          kind: "rule",
          source: "rules_job",
          subjectKey: `category:expense:${key.toLowerCase()}`,
          confidence,
          payloadJson: JSON.stringify(p),
          createdAt: 100,
        },
      ]);
    };
    return { db, dining, groceries, mk };
  }
  const ids = (db: ReturnType<typeof freshDb>) =>
    listProposals(db)
      .map((p) => p.row.id)
      .sort((a, b) => a - b);
  const catOf = (db: ReturnType<typeof freshDb>, id: number) =>
    db
      .select()
      .from(transactions)
      .all()
      .find((t) => t.id === id)!.categoryId;

  it("creates the rule and fills only empty, unsplit rows", () => {
    const { db, dining, groceries, mk } = setup();
    mk("Blue Bottle Coffee", dining, "Dining", "high");
    const empty = addTxn(db, "a1", { description: "SQ *BLUE BOTTLE COFFEE #1" });
    const mine = addTxn(db, "a1", { description: "SQ *BLUE BOTTLE COFFEE #2", categoryId: groceries });
    const split = addTxn(db, "a1", { description: "SQ *BLUE BOTTLE COFFEE #3" });
    db.insert(transactionSplits).values({ transactionId: split.id, categoryId: groceries, amountCents: -1000 }).run();

    const r = acceptRuleProposal(db, ids(db)[0], { applyExisting: true }, 9000);
    expect(r).toMatchObject({ mode: "new", ruleName: "AI · Dining", categorized: 1 });
    expect(catOf(db, empty.id)).toBe(dining);
    expect(catOf(db, mine.id)).toBe(groceries);
    expect(catOf(db, split.id)).toBeNull();
    expect(listProposals(db, { status: "accepted" })[0].row).toMatchObject({ ruleId: r.ruleId, resolvedAt: 9000 });
  });

  it("can skip categorizing existing rows, and honours a changed category", () => {
    const { db, dining, groceries, mk } = setup();
    mk("Blue Bottle Coffee", dining, "Dining", "high");
    const t = addTxn(db, "a1", { description: "BLUE BOTTLE COFFEE" });
    acceptRuleProposal(db, ids(db)[0], { applyExisting: false, categoryId: groceries }, 1);
    expect(catOf(db, t.id)).toBeNull();
    expect(listRules(db)[0]).toMatchObject({ name: "AI · Groceries", actions: { categoryId: groceries } });
    expect(() => acceptRuleProposal(db, 999, { applyExisting: false }, 1)).toThrow(ProposalError);
  });

  it("two proposals for one category produce one rule with two conditions", () => {
    const { db, dining, mk } = setup();
    mk("Blue Bottle Coffee", dining, "Dining", "high");
    mk("Chipotle", dining, "Dining", "high");
    for (const id of ids(db)) acceptRuleProposal(db, id, { applyExisting: false }, 1);
    const rules = listRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0].conditions).toHaveLength(2);
  });

  it("refuses to accept twice, and marks siblings stale", () => {
    const { db, dining, mk } = setup();
    mk("Blue Bottle Coffee", dining, "Dining", "high");
    mk("Blue Bottle Coffee", dining, "Dining", "low"); // same subject key again
    const [first, second] = ids(db);
    acceptRuleProposal(db, first, { applyExisting: false }, 1);
    expect(() => acceptRuleProposal(db, first, { applyExisting: false }, 1)).toThrow(/already handled/);
    expect(getProposal(db, second).row.status).toBe("stale");
  });

  it("accept-all skips low confidence and conflicting suggestions", () => {
    const { db, dining, groceries, mk } = setup();
    mk("Blue Bottle Coffee", dining, "Dining", "high");
    mk("Chipotle", dining, "Dining", "low");
    mk("Safeway", dining, "Dining", "high");
    addTxn(db, "a1", { description: "SAFEWAY #1", categoryId: groceries }); // conflicts with Dining
    addTxn(db, "a1", { description: "SQ *BLUE BOTTLE COFFEE #1" });
    expect(acceptAll(db, { minConfidence: "high", applyExisting: true }, 1, "UTC")).toEqual({
      accepted: 1,
      skipped: 2,
      categorized: 1,
    });
    expect(listProposals(db, { status: "pending" })).toHaveLength(2);
  });

  it("dismissed merchants aren't re-asked until forgotten", () => {
    const { db, dining, mk } = setup();
    mk("Blue Bottle Coffee", dining, "Dining", "high");
    const id = ids(db)[0];
    dismissProposal(db, id, 1);
    expect(hasProposalFor(db, ["category:expense:blue bottle coffee"]).size).toBe(1);
    forgetProposal(db, id);
    expect(hasProposalFor(db, ["category:expense:blue bottle coffee"]).size).toBe(0);
  });
});
