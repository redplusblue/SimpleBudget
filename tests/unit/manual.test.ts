import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, balanceSnapshots, transactions } from "@/db/schema";
import { getAccountsOverview } from "@/lib/finance/accounts-overview";
import { zonedDayStart } from "@/lib/finance/dates";
import {
  createManualAccount,
  createManualTransaction,
  deleteManualAccount,
  deleteManualTransaction,
  ManualError,
  setManualBalance,
  updateManualTransaction,
} from "@/lib/finance/manual";
import { getNetWorthSummary } from "@/lib/finance/networth";
import { setSplits } from "@/lib/finance/splits";
import { queryTransactions } from "@/lib/finance/transactions-query";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const NOW = zonedDayStart("2026-10-24", TZ) + 12 * 3600;
const acct = (db: ReturnType<typeof freshDb>, id: string) =>
  db.select().from(accounts).where(eq(accounts.id, id)).get()!;
const snapshots = (db: ReturnType<typeof freshDb>, id: string) =>
  db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();

describe("manual accounts", () => {
  it("are created with a starting balance and a snapshot, and flagged manual", () => {
    const db = freshDb();
    const id = createManualAccount(db, { name: "  Wallet ", balanceCents: 25_000 }, NOW, TZ);
    expect(acct(db, id)).toMatchObject({
      name: "Wallet",
      type: "cash",
      isManual: true,
      connectionId: null,
      balanceCents: 25_000,
      orgName: "Manual",
    });
    expect(snapshots(db, id)).toEqual([{ accountId: id, date: "2026-10-24", balanceCents: 25_000 }]);
    const [group] = getAccountsOverview(db, NOW + 30 * 86_400, TZ);
    expect(group.accounts[0]).toMatchObject({ isManual: true, stale: false }); // a month later it still isn't "stale"
  });

  it("validates input", () => {
    const db = freshDb();
    expect(() => createManualAccount(db, { name: "  " }, NOW, TZ)).toThrow();
    expect(() => createManualAccount(db, { name: "x", type: "nonsense" }, NOW, TZ)).toThrow();
    expect(() => createManualAccount(db, { name: "x", balanceCents: 1.5 }, NOW, TZ)).toThrow();
  });

  it("can have the balance set by hand, which updates today's snapshot", () => {
    const db = freshDb();
    const id = createManualAccount(db, { name: "Wallet", balanceCents: 25_000 }, NOW, TZ);
    setManualBalance(db, id, 18_000, NOW + 60, TZ);
    expect(acct(db, id).balanceCents).toBe(18_000);
    expect(snapshots(db, id)).toHaveLength(1);
    expect(snapshots(db, id)[0].balanceCents).toBe(18_000);
    setManualBalance(db, id, 9_000, NOW + 2 * 86_400, TZ);
    expect(
      snapshots(db, id)
        .map((s) => s.date)
        .sort(),
    ).toEqual(["2026-10-24", "2026-10-26"]);
  });

  it("count toward net worth", () => {
    const db = freshDb();
    addAccount(db, "bank", { balanceCents: 100_000 });
    db.insert(balanceSnapshots).values({ accountId: "bank", date: "2026-10-24", balanceCents: 100_000 }).run();
    createManualAccount(db, { name: "Wallet", balanceCents: 25_000 }, NOW, TZ);
    expect(getNetWorthSummary(db, "1M", NOW, TZ).totalCents).toBe(125_000);
  });

  it("refuse to touch accounts that sync from a bank", () => {
    const db = freshDb();
    addAccount(db, "bank");
    expect(() => setManualBalance(db, "bank", 1, NOW, TZ)).toThrow(/synced from your bank/);
    expect(() => deleteManualAccount(db, "bank")).toThrow(ManualError);
    expect(() =>
      createManualTransaction(db, "bank", { date: "2026-10-01", amountCents: -100, description: "x" }, NOW, TZ),
    ).toThrow(/synced/);
    expect(() => setManualBalance(db, "nope", 1, NOW, TZ)).toThrow(/not found/);
  });

  it("delete with their transactions", () => {
    const db = freshDb();
    const id = createManualAccount(db, { name: "Wallet" }, NOW, TZ);
    createManualTransaction(db, id, { date: "2026-10-01", amountCents: -100, description: "x" }, NOW, TZ);
    deleteManualAccount(db, id);
    expect(db.select().from(accounts).all()).toEqual([]);
    expect(db.select().from(transactions).all()).toEqual([]);
  });
});

describe("manual transactions", () => {
  function wallet() {
    const db = freshDb();
    const id = createManualAccount(db, { name: "Wallet", balanceCents: 20_000 }, NOW, TZ);
    return { db, id };
  }

  it("are added with source=manual on the chosen local date and move the balance", () => {
    const { db, id } = wallet();
    const dining = categoryId(db, "Dining");
    const tid = createManualTransaction(
      db,
      id,
      { date: "2026-10-20", amountCents: -2_350, description: "Taco truck", categoryId: dining, notes: "  with Sam " },
      NOW,
      TZ,
    );
    const row = queryTransactions(db, {}, { timeZone: TZ }).rows[0];
    expect(row).toMatchObject({
      id: tid,
      amountCents: -2_350,
      categoryId: dining,
      notes: "with Sam",
      displayPayee: "Taco truck",
      pending: false,
      isReviewed: true,
    });
    expect(new Date(row.effectiveDate * 1000).toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(db.select().from(transactions).where(eq(transactions.id, tid)).get()?.source).toBe("manual");
    expect(acct(db, id).balanceCents).toBe(17_650);
    createManualTransaction(db, id, { date: "2026-10-21", amountCents: 5_000, description: "Birthday cash" }, NOW, TZ);
    expect(acct(db, id).balanceCents).toBe(22_650);
  });

  it("validate their fields", () => {
    const { db, id } = wallet();
    const bad = (over: object) => () =>
      createManualTransaction(db, id, { date: "2026-10-20", amountCents: -100, description: "x", ...over }, NOW, TZ);
    expect(bad({ date: "10/20/2026" })).toThrow();
    expect(bad({ amountCents: 0 })).toThrow();
    expect(bad({ amountCents: 0.5 })).toThrow();
    expect(bad({ description: " " })).toThrow();
    expect(bad({ categoryId: 9999 })).toThrow(/Unknown category/);
    expect(acct(db, id).balanceCents).toBe(20_000);
  });

  it("can be edited, adjusting the balance by the difference", () => {
    const { db, id } = wallet();
    const tid = createManualTransaction(
      db,
      id,
      { date: "2026-10-20", amountCents: -2_000, description: "Lunch" },
      NOW,
      TZ,
    );
    updateManualTransaction(db, tid, { amountCents: -3_500, description: "Big lunch", date: "2026-10-19" }, NOW, TZ);
    expect(acct(db, id).balanceCents).toBe(16_500);
    const t = db.select().from(transactions).where(eq(transactions.id, tid)).get()!;
    expect(t).toMatchObject({ amountCents: -3_500, description: "Big lunch" });
    expect(new Date(t.posted * 1000).toISOString().slice(0, 10)).toBe("2026-10-19");
    updateManualTransaction(db, tid, { notes: "x" }, NOW, TZ);
    expect(acct(db, id).balanceCents).toBe(16_500); // unchanged amount, unchanged balance
  });

  it("editing the amount drops a split; choosing a category replaces one", () => {
    const { db, id } = wallet();
    const [a, b] = [categoryId(db, "Dining"), categoryId(db, "Groceries")];
    const tid = createManualTransaction(
      db,
      id,
      { date: "2026-10-20", amountCents: -2_000, description: "Market" },
      NOW,
      TZ,
    );
    setSplits(db, tid, {
      parts: [
        { categoryId: a, amountCents: -1_000 },
        { categoryId: b, amountCents: -1_000 },
      ],
    });
    updateManualTransaction(db, tid, { amountCents: -2_500 }, NOW, TZ);
    expect(queryTransactions(db, {}, { timeZone: TZ }).rows[0].splitCount).toBe(0);
    setSplits(db, tid, {
      parts: [
        { categoryId: a, amountCents: -1_500 },
        { categoryId: b, amountCents: -1_000 },
      ],
    });
    updateManualTransaction(db, tid, { categoryId: a }, NOW, TZ);
    expect(queryTransactions(db, {}, { timeZone: TZ }).rows[0]).toMatchObject({ splitCount: 0, categoryId: a });
  });

  it("can be deleted, restoring the balance", () => {
    const { db, id } = wallet();
    const tid = createManualTransaction(
      db,
      id,
      { date: "2026-10-20", amountCents: -2_000, description: "Lunch" },
      NOW,
      TZ,
    );
    deleteManualTransaction(db, tid, NOW, TZ);
    expect(acct(db, id).balanceCents).toBe(20_000);
    expect(db.select().from(transactions).all()).toEqual([]);
  });

  it("only manual transactions can be edited or deleted this way", () => {
    const { db } = wallet();
    addAccount(db, "bank");
    const synced = addTxn(db, "bank", { amountCents: -500 });
    expect(() => updateManualTransaction(db, synced.id, { amountCents: -1 }, NOW, TZ)).toThrow(/added by hand/);
    expect(() => deleteManualTransaction(db, synced.id, NOW, TZ)).toThrow(ManualError);
    expect(() => deleteManualTransaction(db, 9999, NOW, TZ)).toThrow(/not found/);
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it("deleting one side of a transfer unpairs the other", () => {
    const { db, id } = wallet();
    addAccount(db, "bank");
    const tid = createManualTransaction(
      db,
      id,
      { date: "2026-10-20", amountCents: 6_000, description: "ATM withdrawal" },
      NOW,
      TZ,
    );
    const withdrawal = addTxn(db, "bank", { amountCents: -6_000, isTransfer: true, transferPairId: tid });
    db.update(transactions)
      .set({ isTransfer: true, transferPairId: withdrawal.id })
      .where(eq(transactions.id, tid))
      .run();
    deleteManualTransaction(db, tid, NOW, TZ);
    expect(db.select().from(transactions).where(eq(transactions.id, withdrawal.id)).get()).toMatchObject({
      isTransfer: false,
      transferPairId: null,
    });
  });
});
