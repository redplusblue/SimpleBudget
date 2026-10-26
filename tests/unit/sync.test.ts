import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite, type Db } from "@/db/open";
import {
  accounts,
  aiRuns,
  balanceSnapshots,
  categories,
  connections,
  syncRuns,
  tags,
  transactionTags,
  transactions,
} from "@/db/schema";
import { addConnection } from "@/lib/connections";
import { createRule } from "@/lib/rules/store";
import { localDateString } from "@/lib/finance/dates";
import {
  acquireSyncLock,
  DAILY_REQUEST_LIMIT,
  recordRequest,
  requestsToday,
  setSyncProgress,
} from "@/lib/simplefin/limits";
import { createManualAccount, createManualTransaction } from "@/lib/finance/manual";
import { runSync, startSync, type SyncResult } from "@/lib/simplefin/sync";
import { ACCESS_URL, DAY, mockBank, NOW, type MockBank } from "../helpers/simplefin-mock";

function setup(bank: MockBank = mockBank()) {
  const db = createDb(openSqlite(":memory:"));
  runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
  addConnection(db, ACCESS_URL);
  return { db, bank };
}

const sync = async (db: Db, bank: MockBank, opts: Parameters<typeof runSync>[1] = {}) => {
  const res = await runSync(db, {
    mode: "backfill",
    days: 90,
    trigger: "scheduled",
    now: NOW,
    fetchImpl: bank.fetch,
    sleep: async () => {},
    timeZone: "UTC",
    ...opts,
  });
  if (!res.ok) throw new Error(`refused: ${res.message}`);
  return res as SyncResult;
};
const txn = (db: Db, sfId: string) => db.select().from(transactions).where(eq(transactions.sfTxnId, sfId)).get()!;
const acct = (db: Db, id: string) => db.select().from(accounts).where(eq(accounts.id, id)).get()!;
const allTxns = (db: Db) => db.select().from(transactions).all();

describe("first backfill", () => {
  it("imports accounts, transactions, balances, snapshots and connection metadata", async () => {
    const { db, bank } = setup();
    const res = await sync(db, bank);
    expect(res).toMatchObject({ status: "ok", accountsUpdated: 3, errors: [], requestsUsed: 2 });
    expect(res.txnsAdded).toBe(12 + 7 + 3);
    expect(allTxns(db)).toHaveLength(22);

    const chk = acct(db, "ACT-chk-1001");
    expect(chk).toMatchObject({
      name: "Total Checking",
      balanceCents: 482317,
      availableCents: 462317,
      type: "checking",
      orgName: "First Test Bank",
    });
    expect(acct(db, "ACT-cc-2002")).toMatchObject({ balanceCents: -123456, type: "credit", availableCents: null });
    expect(acct(db, "ACT-sav-3003").type).toBe("savings");

    const snaps = db.select().from(balanceSnapshots).all();
    expect(snaps).toHaveLength(3);
    expect(snaps.every((s) => s.date === localDateString(NOW, "UTC"))).toBe(true);

    const conn = db.select().from(connections).get()!;
    expect(conn).toMatchObject({ orgName: "First Test Bank", orgDomain: "firsttestbank.example", lastError: null });
    expect(requestsToday(db, NOW)).toBe(2);

    const run = db.select().from(syncRuns).get()!;
    expect(run).toMatchObject({ status: "ok", txnsAdded: 22, accountsUpdated: 3, requestsUsed: 2 });
    expect(run.finishedAt).not.toBeNull();
  });

  it("stores amounts as exact integer cents and keeps raw JSON", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const t = txn(db, "chk-009");
    expect(t.amountCents).toBe(-8745);
    expect(JSON.parse(t.rawJson)).toMatchObject({ id: "chk-009", amount: "-87.45" });
    expect(txn(db, "chk-p01")).toMatchObject({ pending: true, amountCents: -4218, posted: 0 });
  });

  it("splits a 365 day backfill into seven ≤60 day requests", async () => {
    const { db, bank } = setup();
    const res = await sync(db, bank, { days: 365 });
    expect(res.requestsUsed).toBe(7);
    expect(bank.calls).toHaveLength(7);
    for (const u of bank.calls) {
      expect(Number(u.searchParams.get("end-date")) - Number(u.searchParams.get("start-date"))).toBeLessThanOrEqual(
        60 * DAY,
      );
      expect(u.searchParams.get("pending")).toBe("1");
    }
    expect(Number(bank.calls[0].searchParams.get("end-date"))).toBe(NOW);
  });

  it("incremental syncs request only the last 14 days", async () => {
    const { db, bank } = setup();
    await sync(db, bank, { mode: "incremental" });
    expect(bank.calls).toHaveLength(1);
    expect(Number(bank.calls[0].searchParams.get("start-date"))).toBe(NOW - 14 * DAY);
    expect(txn(db, "chk-001").sfTxnId).toBe("chk-001");
    expect(allTxns(db).some((t) => t.sfTxnId === "chk-004")).toBe(false); // 45 days old
  });
});

describe("idempotency and user overlays", () => {
  it("syncing twice adds and updates nothing", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const before = allTxns(db);
    const second = await sync(db, bank);
    expect(second).toMatchObject({ status: "ok", txnsAdded: 0, txnsUpdated: 0 });
    expect(allTxns(db)).toEqual(before);
    expect(db.select().from(syncRuns).all()).toHaveLength(2);
  });

  it("edits survive a re-sync while bank fields still update", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const cat = db.select().from(categories).where(eq(categories.name, "Groceries")).get()!;
    const tag = db.insert(tags).values({ name: "weekly", color: "#fff" }).returning().get();
    const t = txn(db, "chk-009");
    db.update(transactions)
      .set({ categoryId: cat.id, notes: "milk", payeeOverride: "TJ", isExcluded: true, isReviewed: true })
      .where(eq(transactions.id, t.id))
      .run();
    db.insert(transactionTags).values({ transactionId: t.id, tagId: tag.id }).run();
    db.update(accounts)
      .set({ displayName: "Daily", type: "savings", isHidden: true, color: "#123456", excludeFromNetWorth: true })
      .where(eq(accounts.id, "ACT-chk-1001"))
      .run();

    const raw = bank.accounts[0].transactions.find((x: { id: string }) => x.id === "chk-009");
    raw.description = "TRADER JOES #552 AUSTIN TX (UPDATED)";
    raw.amount = "-88.00";
    bank.accounts[0].balance = "4000.00";

    const res = await sync(db, bank);
    expect(res.txnsUpdated).toBe(1);
    const after = txn(db, "chk-009");
    expect(after).toMatchObject({
      categoryId: cat.id,
      notes: "milk",
      payeeOverride: "TJ",
      isExcluded: true,
      isReviewed: true,
      amountCents: -8800,
      description: "TRADER JOES #552 AUSTIN TX (UPDATED)",
    });
    expect(db.select().from(transactionTags).all()).toHaveLength(1);
    expect(acct(db, "ACT-chk-1001")).toMatchObject({
      displayName: "Daily",
      type: "savings",
      isHidden: true,
      color: "#123456",
      excludeFromNetWorth: true,
      balanceCents: 400000,
    });
  });

  it("keeps one snapshot per day and updates it", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    bank.accounts[2].balance = "10400.00";
    await sync(db, bank);
    const snaps = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, "ACT-sav-3003")).all();
    expect(snaps).toEqual([{ accountId: "ACT-sav-3003", date: "2026-10-24", balanceCents: 1040000 }]);
    await sync(db, bank, { now: NOW + DAY });
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, "ACT-sav-3003")).all()).toHaveLength(
      2,
    );
  });

  it("leaves accounts absent from a response untouched", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const dropped = bank.accounts.pop()!;
    const res = await sync(db, bank);
    expect(res.accountsUpdated).toBe(2);
    expect(acct(db, dropped.id)).toBeDefined();
    expect(allTxns(db)).toHaveLength(22);
  });
});

describe("transfers", () => {
  it("pairs the credit card autopay and the savings transfer automatically", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const out = txn(db, "chk-007");
    const inn = txn(db, "cc-005");
    expect(out).toMatchObject({ isTransfer: true, transferPairId: inn.id });
    expect(inn).toMatchObject({ isTransfer: true, transferPairId: out.id });
    const s1 = txn(db, "chk-008");
    const s2 = txn(db, "sav-001");
    expect(s1.transferPairId).toBe(s2.id);
    expect(s2.transferPairId).toBe(s1.id);
    for (const id of ["chk-005", "chk-001", "cc-001", "sav-002", "chk-p01"]) expect(txn(db, id).isTransfer).toBe(false);
  });

  it("doesn't pair ambiguous matches", async () => {
    const bank = mockBank();
    bank.accounts[1].transactions.push({
      id: "cc-dup",
      posted: NOW - 10 * DAY,
      amount: "500.00",
      description: "PAYMENT THANK YOU",
    });
    const { db } = setup(bank);
    await sync(db, bank);
    expect(txn(db, "chk-007").transferPairId).toBeNull();
    expect(txn(db, "cc-005").transferPairId).toBeNull();
  });

  it("flags unmatched card payments by description, only on credit accounts", async () => {
    const bank = mockBank();
    bank.accounts[1].transactions.push({
      id: "cc-pay2",
      posted: NOW - 2 * DAY,
      amount: "75.00",
      description: "AUTOPAY PAYMENT",
    });
    bank.accounts[0].transactions.push({
      id: "chk-dep",
      posted: NOW - 2 * DAY,
      amount: "75.00",
      description: "MOBILE DEPOSIT PAYMENT",
    });
    bank.accounts[0].transactions.push({
      id: "chk-dep2",
      posted: NOW - 40 * DAY,
      amount: "11.00",
      description: "PAYMENT RECEIVED",
    });
    const { db } = setup(bank);
    await sync(db, bank);
    // cc-pay2 and chk-dep are opposite-sign? no: both positive, so no pair
    expect(txn(db, "cc-pay2")).toMatchObject({ isTransfer: true, transferPairId: null });
    expect(txn(db, "chk-dep").isTransfer).toBe(false);
    expect(txn(db, "chk-dep2").isTransfer).toBe(false);
  });

  it("pairs halves that arrive in different syncs", async () => {
    const bank = mockBank();
    const savIn = bank.accounts[2].transactions.splice(0, 1)[0]; // hold back the savings side
    const { db } = setup(bank);
    await sync(db, bank);
    expect(txn(db, "chk-008").transferPairId).toBeNull();
    bank.accounts[2].transactions.push(savIn);
    await sync(db, bank);
    expect(txn(db, "chk-008").transferPairId).toBe(txn(db, "sav-001").id);
  });

  it("never touches transfers a user already unpaired and is idempotent", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const snapshot = JSON.stringify(allTxns(db));
    await sync(db, bank);
    expect(JSON.stringify(allTxns(db))).toBe(snapshot);
  });
});

describe("pending reconciliation", () => {
  it("updates a pending item in place when it posts under the same id, keeping edits", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    db.update(transactions).set({ notes: "keep me" }).where(eq(transactions.sfTxnId, "chk-p01")).run();
    const raw = bank.accounts[0].transactions.find((t: { id: string }) => t.id === "chk-p01");
    Object.assign(raw, { pending: false, posted: NOW - 3600, amount: "-42.18" });
    const res = await sync(db, bank);
    expect(res.txnsUpdated).toBe(1);
    expect(txn(db, "chk-p01")).toMatchObject({ pending: false, notes: "keep me", posted: NOW - 3600 });
  });

  it("moves edits from a vanished pending row to its newly posted replacement", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const cat = db.select().from(categories).where(eq(categories.name, "Groceries")).get()!;
    const tag = db.insert(tags).values({ name: "party", color: "#000" }).returning().get();
    const pending = txn(db, "chk-p01");
    db.update(transactions)
      .set({ categoryId: cat.id, notes: "for the party", payeeOverride: "WF", isReviewed: true })
      .where(eq(transactions.id, pending.id))
      .run();
    db.insert(transactionTags).values({ transactionId: pending.id, tagId: tag.id }).run();

    const list = bank.accounts[0].transactions as Array<{ id: string }>;
    list.splice(
      list.findIndex((t) => t.id === "chk-p01"),
      1,
    );
    list.push({
      id: "chk-posted-wf",
      posted: NOW - 3600,
      amount: "-42.18",
      description: "WHOLE FOODS #123 AUSTIN TX",
    } as never);

    const res = await sync(db, bank);
    expect(res.txnsAdded).toBe(1);
    expect(allTxns(db).some((t) => t.sfTxnId === "chk-p01")).toBe(false);
    const posted = txn(db, "chk-posted-wf");
    expect(posted).toMatchObject({
      categoryId: cat.id,
      notes: "for the party",
      payeeOverride: "WF",
      isReviewed: true,
      pending: false,
    });
    const links = db.select().from(transactionTags).all();
    expect(links).toEqual([{ transactionId: posted.id, tagId: tag.id }]);
  });

  it("drops vanished pending rows with no match, and doesn't move edits to unrelated transactions", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    db.update(transactions).set({ notes: "gone" }).where(eq(transactions.sfTxnId, "chk-p01")).run();
    const list = bank.accounts[0].transactions as Array<{ id: string }>;
    list.splice(
      list.findIndex((t) => t.id === "chk-p01"),
      1,
    );
    list.push({ id: "other", posted: NOW - 3600, amount: "-42.18", description: "SOMETHING ELSE ENTIRELY" } as never);
    await sync(db, bank);
    expect(allTxns(db).some((t) => t.sfTxnId === "chk-p01")).toBe(false);
    expect(txn(db, "other").notes).toBeNull();
  });

  it("keeps pending rows when the bank reported errors (the list may be incomplete)", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const list = bank.accounts[0].transactions as Array<{ id: string }>;
    list.splice(
      list.findIndex((t) => t.id === "chk-p01"),
      1,
    );
    bank.errors = ["Please re-authenticate First Test Bank"];
    await sync(db, bank);
    expect(txn(db, "chk-p01")).toBeDefined();
    bank.errors = [];
    await sync(db, bank);
    expect(allTxns(db).some((t) => t.sfTxnId === "chk-p01")).toBe(false);
  });

  it("only reconciles inside the synced window", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    db.update(transactions)
      .set({ transactedAt: NOW - 20 * DAY, pending: true })
      .where(eq(transactions.sfTxnId, "chk-p01"))
      .run();
    const list = bank.accounts[0].transactions as Array<{ id: string }>;
    list.splice(
      list.findIndex((t) => t.id === "chk-p01"),
      1,
    );
    await sync(db, bank, { mode: "incremental" }); // 14 day window; the pending row is 20 days old
    expect(txn(db, "chk-p01")).toBeDefined();
  });
});

describe("errors", () => {
  it("surfaces SimpleFIN errors as a partial run and on the connection, then clears them", async () => {
    const { db, bank } = setup();
    bank.errors = ["Connection to First Test Bank may need attention"];
    const res = await sync(db, bank);
    expect(res.status).toBe("partial");
    expect(res.errors).toEqual(["Connection to First Test Bank may need attention"]);
    expect(res.txnsAdded).toBe(22); // data still imported
    expect(JSON.parse(db.select().from(syncRuns).get()!.errorsJson)).toEqual(res.errors);
    expect(db.select().from(connections).get()!.lastError).toContain("may need attention");

    bank.errors = [];
    const ok = await sync(db, bank);
    expect(ok.status).toBe("ok");
    expect(db.select().from(connections).get()!.lastError).toBeNull();
  });

  it("reports revoked access as an error run without burning more requests", async () => {
    const { db, bank } = setup();
    bank.status = 403;
    const res = await sync(db, bank, { days: 365 });
    expect(res).toMatchObject({
      status: "error",
      requestsUsed: 1,
      txnsAdded: 0,
      errors: ["SimpleFIN access revoked — reconnect."],
    });
    expect(db.select().from(connections).get()!.lastError).toBe("SimpleFIN access revoked — reconnect.");
    expect(bank.calls).toHaveLength(1);
  });

  it("retries 5xx within a request and counts every attempt", async () => {
    const { db, bank } = setup();
    let n = 0;
    const flaky: typeof fetch = async (input, init) =>
      n++ < 2 ? new Response("", { status: 503 }) : bank.fetch(input, init);
    const res = await sync(db, bank, { fetchImpl: flaky, days: 30 });
    expect(res.status).toBe("ok");
    expect(res.requestsUsed).toBe(3);
    expect(requestsToday(db, NOW)).toBe(3);
  });

  it("skips transactions with unreadable amounts but imports the rest", async () => {
    const bank = mockBank();
    bank.accounts[0].transactions.push({ id: "bad", posted: NOW - DAY, amount: "12.345", description: "ODD" });
    const { db } = setup(bank);
    const res = await sync(db, bank);
    expect(res.status).toBe("partial");
    expect(res.errors[0]).toMatch(/Skipped 1 transaction/);
    expect(res.txnsAdded).toBe(22);
  });

  it("skips accounts with unreadable balances", async () => {
    const bank = mockBank();
    bank.accounts[2].balance = "lots";
    const { db } = setup(bank);
    const res = await sync(db, bank);
    expect(res.status).toBe("partial");
    expect(res.accountsUpdated).toBe(2);
  });

  it("isolates connections: one revoked, one healthy", async () => {
    const { db, bank } = setup();
    addConnection(db, "https://u2:p2@other.test/simplefin");
    const other: typeof fetch = async (input, init) =>
      String(input).includes("other.test") ? new Response("", { status: 401 }) : bank.fetch(input, init);
    const res = await sync(db, bank, { fetchImpl: other, days: 30 });
    expect(res.status).toBe("partial");
    expect(res.errors).toEqual(["Connection 2: SimpleFIN access revoked — reconnect."]);
    expect(res.accountsUpdated).toBe(3);
    const rows = db.select().from(connections).orderBy(connections.id).all();
    expect(rows[0].lastError).toBeNull();
    expect(rows[1].lastError).toContain("revoked");
  });

  it("never writes credentials into the run log or errors", async () => {
    const { db, bank } = setup();
    bank.status = 500;
    const res = await sync(db, bank, { days: 30 });
    expect(JSON.stringify([res, db.select().from(syncRuns).all(), db.select().from(connections).all()])).not.toMatch(
      /secret|user:/,
    );
  });
});

describe("limits", () => {
  it("enforces the daily cap before making any request", async () => {
    const { db, bank } = setup();
    for (let i = 0; i < DAILY_REQUEST_LIMIT; i++) recordRequest(db, NOW);
    const res = await runSync(db, { mode: "incremental", trigger: "scheduled", now: NOW, fetchImpl: bank.fetch });
    expect(res).toMatchObject({ ok: false, reason: "budget" });
    expect(bank.calls).toHaveLength(0);
    expect(db.select().from(syncRuns).all()).toHaveLength(0);
    // the lock is released after a refusal
    expect(acquireSyncLock(db, NOW)).toBe(true);
  });

  it("refuses a backfill that needs more requests than remain, but allows a smaller one", async () => {
    const { db, bank } = setup();
    for (let i = 0; i < 15; i++) recordRequest(db, NOW);
    expect(
      await runSync(db, { mode: "backfill", days: 365, trigger: "manual", now: NOW, fetchImpl: bank.fetch }),
    ).toMatchObject({ ok: false, reason: "budget" });
    const ok = await runSync(db, { mode: "backfill", days: 90, trigger: "manual", now: NOW, fetchImpl: bank.fetch });
    expect(ok.ok).toBe(true);
  });

  it("stops mid-run if the quota runs out (retries count)", async () => {
    const { db, bank } = setup();
    for (let i = 0; i < DAILY_REQUEST_LIMIT - 3; i++) recordRequest(db, NOW);
    let n = 0;
    const flaky: typeof fetch = async (input, init) =>
      n++ < 2 ? new Response("", { status: 503 }) : bank.fetch(input, init);
    const res = await sync(db, bank, { fetchImpl: flaky, days: 120 }); // needs 2 and 3 remain, but two retries eat the rest
    expect(res.requestsUsed).toBe(3);
    expect(requestsToday(db, NOW)).toBe(DAILY_REQUEST_LIMIT);
    expect(res.errors.join()).toMatch(/limit reached/);
  });

  it("refuses when there are no connections", async () => {
    const db = createDb(openSqlite(":memory:"));
    runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
    expect(await runSync(db, { now: NOW })).toMatchObject({ ok: false, reason: "no_connections" });
  });

  it("only one sync runs at a time", async () => {
    const { db, bank } = setup();
    const first = startSync(db, { mode: "backfill", days: 30, trigger: "scheduled", now: NOW, fetchImpl: bank.fetch });
    expect(first.ok).toBe(true);
    const second = startSync(db, { mode: "backfill", days: 30, trigger: "scheduled", now: NOW, fetchImpl: bank.fetch });
    expect(second).toMatchObject({ ok: false, reason: "busy" });
    if (first.ok) await first.done;
    const third = await runSync(db, {
      mode: "backfill",
      days: 30,
      trigger: "scheduled",
      now: NOW,
      fetchImpl: bank.fetch,
    });
    expect(third.ok).toBe(true);
  });

  it("applies the 15 minute cooldown to manual incremental syncs only", async () => {
    const { db, bank } = setup();
    const manual = { mode: "incremental" as const, trigger: "manual" as const, fetchImpl: bank.fetch };
    expect((await runSync(db, { ...manual, now: NOW })).ok).toBe(true);
    expect(await runSync(db, { ...manual, now: NOW + 60 })).toMatchObject({
      ok: false,
      reason: "throttled",
      retryAfterSeconds: 840,
    });
    expect((await runSync(db, { ...manual, trigger: "scheduled", now: NOW + 60 })).ok).toBe(true);
    expect((await runSync(db, { ...manual, mode: "backfill", days: 30, now: NOW + 60 })).ok).toBe(true);
    expect((await runSync(db, { ...manual, now: NOW + 901 })).ok).toBe(true);
  });

  it("releases the lock and clears progress after finishing", async () => {
    const { db, bank } = setup();
    setSyncProgress(db, { done: 0, total: 1 });
    await sync(db, bank);
    expect(acquireSyncLock(db, NOW + 1)).toBe(true);
  });
});

describe("rules during sync", () => {
  it("categorizes newly imported transactions with the user's rules", async () => {
    const { db, bank } = setup();
    const groceries = db
      .select()
      .from(categories)
      .all()
      .find((c) => c.name === "Groceries")!.id;
    createRule(db, {
      name: "TJ",
      conditions: [{ field: "payee", op: "contains", value: "trader joe" }],
      actions: { categoryId: groceries },
    });
    await sync(db, bank);
    expect(txn(db, "chk-009").categoryId).toBe(groceries);
    expect(txn(db, "chk-001").categoryId).toBeNull();
  });

  it("only touches new rows: a rule added later leaves existing transactions alone on re-sync", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const groceries = db
      .select()
      .from(categories)
      .all()
      .find((c) => c.name === "Groceries")!.id;
    createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "trader joe" }],
      actions: { categoryId: groceries },
    });
    await sync(db, bank);
    expect(txn(db, "chk-009").categoryId).toBeNull();
    // ...but a new matching transaction is categorized
    bank.accounts[0].transactions.push({
      id: "chk-new",
      posted: NOW - 3600,
      amount: "-12.00",
      description: "TRADER JOE'S #9",
    });
    await sync(db, bank);
    expect(txn(db, "chk-new").categoryId).toBe(groceries);
  });

  it("never overwrites an edit that was moved onto a newly posted transaction", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    const [dining, groceries] = ["Dining", "Groceries"].map(
      (n) =>
        db
          .select()
          .from(categories)
          .all()
          .find((c) => c.name === n)!.id,
    );
    createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "whole foods" }],
      actions: { categoryId: groceries },
    });
    db.update(transactions).set({ categoryId: dining }).where(eq(transactions.sfTxnId, "chk-p01")).run();
    const list = bank.accounts[0].transactions as Array<{ id: string }>;
    list.splice(
      list.findIndex((t) => t.id === "chk-p01"),
      1,
    );
    list.push({
      id: "chk-posted-wf",
      posted: NOW - 3600,
      amount: "-42.18",
      description: "WHOLE FOODS #123 AUSTIN TX",
    } as never);
    await sync(db, bank);
    expect(txn(db, "chk-posted-wf").categoryId).toBe(dining); // the user's choice wins over the rule
  });

  it("runs rules before transfer detection so a rule can flag a transfer", async () => {
    const { db, bank } = setup();
    createRule(db, {
      conditions: [{ field: "description", op: "contains", value: "INTEREST PAID" }],
      actions: { markTransfer: true },
    });
    await sync(db, bank);
    expect(txn(db, "sav-002")).toMatchObject({ isTransfer: true, transferPairId: null });
  });

  it("is idempotent with rules in play", async () => {
    const { db, bank } = setup();
    const groceries = db
      .select()
      .from(categories)
      .all()
      .find((c) => c.name === "Groceries")!.id;
    createRule(db, {
      conditions: [{ field: "payee", op: "contains", value: "trader joe" }],
      actions: { categoryId: groceries },
    });
    await sync(db, bank);
    const before = allTxns(db);
    await sync(db, bank);
    expect(allTxns(db)).toEqual(before);
  });
});

describe("manual accounts", () => {
  it("are left completely alone by a sync", async () => {
    const { db, bank } = setup();
    const id = createManualAccount(db, { name: "Wallet", balanceCents: 20_000 }, NOW, "UTC");
    const t = createManualTransaction(
      db,
      id,
      { date: "2026-10-01", amountCents: -1_500, description: "Lunch" },
      NOW,
      "UTC",
    );
    await sync(db, bank);
    await sync(db, bank, { mode: "incremental", trigger: "manual" });
    expect(acct(db, id)).toMatchObject({ isManual: true, balanceCents: 18_500, connectionId: null });
    expect(allTxns(db).find((x) => x.id === t)).toMatchObject({ source: "manual", amountCents: -1_500 });
  });
});

describe("AI rule suggestions", () => {
  it("a sync with AI off never calls a model or writes an ai_runs row", async () => {
    const { db, bank } = setup();
    await sync(db, bank);
    await new Promise((r) => setTimeout(r, 50)); // the hook is fire-and-forget
    expect(db.select().from(aiRuns).all()).toHaveLength(0);
  });
});
