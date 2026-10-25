import { describe, expect, it } from "vitest";
import { accounts, transactionTags, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  queryTransactions,
  decodeCursor,
  InvalidCursorError,
  getTransactionDetail,
} from "@/lib/finance/transactions-query";
import { zonedDayStart } from "@/lib/finance/dates";
import type { TransactionFilters } from "@/lib/finance/transaction-types";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const day = (d: string) => zonedDayStart(d, TZ);

function allPages(db: ReturnType<typeof freshDb>, filters: TransactionFilters = {}, limit = 3) {
  const ids: number[] = [];
  let cursor: string | null | undefined;
  let guard = 0;
  do {
    const page = queryTransactions(db, filters, { cursor, limit, timeZone: TZ });
    ids.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor && ++guard < 1000);
  return ids;
}

describe("ordering and paging", () => {
  it("lists pending first, then newest posted, and pages without gaps or duplicates", () => {
    const db = freshDb();
    addAccount(db, "a");
    const ids = [
      addTxn(db, "a", { posted: day("2026-01-01") }).id,
      addTxn(db, "a", { posted: day("2026-01-03") }).id,
      addTxn(db, "a", { posted: day("2026-01-03") }).id, // same time: higher id first
      addTxn(db, "a", { posted: day("2026-01-02") }).id,
      addTxn(db, "a", { posted: 0, pending: true, transactedAt: day("2026-01-02") }).id,
      addTxn(db, "a", { posted: 0, pending: true, transactedAt: day("2026-01-04") }).id,
    ];
    const [t1, t3a, t3b, t2, p1, p2] = ids;
    expect(allPages(db, {}, 100)).toEqual([p2, p1, t3b, t3a, t2, t1]);
    expect(allPages(db, {}, 2)).toEqual([p2, p1, t3b, t3a, t2, t1]);
    expect(allPages(db, {}, 1)).toEqual([p2, p1, t3b, t3a, t2, t1]);
  });

  it("returns the total only on the first page and no cursor when done", () => {
    const db = freshDb();
    addAccount(db, "a");
    for (let i = 0; i < 5; i++) addTxn(db, "a");
    const p1 = queryTransactions(db, {}, { limit: 2, timeZone: TZ });
    expect(p1.total).toBe(5);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = queryTransactions(db, {}, { limit: 2, cursor: p1.nextCursor, timeZone: TZ });
    expect(p2.total).toBeUndefined();
    const last = queryTransactions(db, {}, { limit: 10, timeZone: TZ });
    expect(last.nextCursor).toBeNull();
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeCursor("garbage")).toThrow(InvalidCursorError);
    expect(() => decodeCursor(Buffer.from("1.2").toString("base64url"))).toThrow(InvalidCursorError);
  });

  it("caps the page size", () => {
    const db = freshDb();
    addAccount(db, "a");
    for (let i = 0; i < 205; i++) addTxn(db, "a");
    expect(queryTransactions(db, {}, { limit: 9999, timeZone: TZ }).rows).toHaveLength(200);
  });
});

describe("filters", () => {
  function fixture() {
    const db = freshDb();
    addAccount(db, "chk");
    addAccount(db, "cc", { type: "credit" });
    const groceries = categoryId(db, "Groceries");
    const income = categoryId(db, "Income");
    const tag = addTag(db, "trip");
    const rows = {
      coffee: addTxn(db, "chk", {
        description: "BLUE BOTTLE COFFEE",
        amountCents: -450,
        posted: day("2026-03-05") + 3600,
      }),
      grocery: addTxn(db, "chk", {
        description: "TRADER JOES",
        payeeOverride: "Groceries Co",
        amountCents: -8745,
        categoryId: groceries,
        posted: day("2026-03-10"),
      }),
      pay: addTxn(db, "chk", {
        description: "ACME PAYROLL",
        amountCents: 245000,
        categoryId: income,
        posted: day("2026-03-15"),
      }),
      transfer: addTxn(db, "chk", {
        description: "CARD PAYMENT",
        amountCents: -50000,
        isTransfer: true,
        posted: day("2026-03-16"),
      }),
      excluded: addTxn(db, "cc", {
        description: "REIMBURSED LUNCH",
        amountCents: -2000,
        isExcluded: true,
        posted: day("2026-03-20"),
      }),
      refund: addTxn(db, "cc", {
        description: "AMAZON REFUND",
        amountCents: 1500,
        posted: day("2026-03-21"),
        notes: "Return of the kettle",
      }),
      pending: addTxn(db, "cc", {
        description: "UBER",
        amountCents: -2350,
        pending: true,
        posted: 0,
        transactedAt: day("2026-03-22"),
      }),
      reviewed: addTxn(db, "cc", {
        description: "OLD",
        amountCents: -100,
        isReviewed: true,
        posted: day("2026-02-01"),
      }),
    };
    db.insert(transactionTags).values({ transactionId: rows.coffee.id, tagId: tag.id }).run();
    return { db, rows, groceries, income, tag };
  }
  const ids = (db: ReturnType<typeof freshDb>, f: TransactionFilters) => new Set(allPages(db, f, 100));

  it("filters by account", () => {
    const { db, rows } = fixture();
    expect(ids(db, { accountId: "cc" })).toEqual(
      new Set([rows.excluded.id, rows.refund.id, rows.pending.id, rows.reviewed.id]),
    );
  });

  it("searches description, override, notes and amounts, all terms required, case-insensitively", () => {
    const { db, rows } = fixture();
    expect(ids(db, { q: "coffee" })).toEqual(new Set([rows.coffee.id]));
    expect(ids(db, { q: "BLUE bottle" })).toEqual(new Set([rows.coffee.id]));
    expect(ids(db, { q: "groceries co" })).toEqual(new Set([rows.grocery.id])); // payee override
    expect(ids(db, { q: "kettle" })).toEqual(new Set([rows.refund.id])); // notes
    expect(ids(db, { q: "87.45" })).toEqual(new Set([rows.grocery.id])); // amount
    expect(ids(db, { q: "$4.50" })).toEqual(new Set([rows.coffee.id]));
    expect(ids(db, { q: "coffee payroll" })).toEqual(new Set());
  });

  it("treats LIKE wildcards literally", () => {
    const { db } = fixture();
    expect(ids(db, { q: "%" }).size).toBe(0);
    expect(ids(db, { q: "_" }).size).toBe(0);
  });

  it("filters by inclusive local date range", () => {
    const { db, rows } = fixture();
    expect(ids(db, { from: "2026-03-05", to: "2026-03-10" })).toEqual(new Set([rows.coffee.id, rows.grocery.id]));
    expect(ids(db, { from: "2026-03-11" }).has(rows.coffee.id)).toBe(false);
    expect(ids(db, { to: "2026-02-28" })).toEqual(new Set([rows.reviewed.id]));
    // pending items filter by their purchase date
    expect(ids(db, { from: "2026-03-22", to: "2026-03-22" })).toEqual(new Set([rows.pending.id]));
    expect(ids(db, { from: "not-a-date" }).size).toBe(8); // invalid dates are ignored
  });

  it("filters by category, uncategorized and tag", () => {
    const { db, rows, groceries, tag } = fixture();
    expect(ids(db, { categoryId: groceries })).toEqual(new Set([rows.grocery.id]));
    expect(ids(db, { categoryId: "none" }).size).toBe(6);
    expect(ids(db, { tagId: tag.id })).toEqual(new Set([rows.coffee.id]));
  });

  it("filters by absolute amount range", () => {
    const { db, rows } = fixture();
    expect(ids(db, { minAmountCents: 2000, maxAmountCents: 10000 })).toEqual(
      new Set([rows.grocery.id, rows.excluded.id, rows.pending.id]),
    );
    expect(ids(db, { minAmountCents: 50000 })).toEqual(new Set([rows.pay.id, rows.transfer.id]));
  });

  it("applies the expense / income / transfer definitions", () => {
    const { db, rows } = fixture();
    // expense: negative, not transfer, not excluded, not under an income category
    expect(ids(db, { type: "expense" })).toEqual(
      new Set([rows.coffee.id, rows.grocery.id, rows.pending.id, rows.reviewed.id]),
    );
    expect(ids(db, { type: "income" })).toEqual(new Set([rows.pay.id, rows.refund.id]));
    expect(ids(db, { type: "transfer" })).toEqual(new Set([rows.transfer.id]));
  });

  it("excludes negative amounts filed under an income category from expenses", () => {
    const { db, income } = fixture();
    const odd = addTxn(db, "chk", { amountCents: -500, categoryId: income });
    expect(ids(db, { type: "expense" }).has(odd.id)).toBe(false);
  });

  it("filters by status", () => {
    const { db, rows } = fixture();
    expect(ids(db, { status: "pending" })).toEqual(new Set([rows.pending.id]));
    expect(ids(db, { status: "reviewed" })).toEqual(new Set([rows.reviewed.id]));
    expect(ids(db, { status: "unreviewed" }).size).toBe(7);
  });

  it("combines filters and keeps the total consistent with the rows", () => {
    const { db, rows } = fixture();
    const f: TransactionFilters = { accountId: "chk", type: "expense", from: "2026-03-01", to: "2026-03-31" };
    expect(ids(db, f)).toEqual(new Set([rows.coffee.id, rows.grocery.id]));
    expect(queryTransactions(db, f, { timeZone: TZ }).total).toBe(2);
  });

  it("filters by merchant key", () => {
    const { db, rows } = fixture();
    const other = addTxn(db, "chk", {
      description: "BLUE BOTTLE COFFEE #9 SAN FRANCISCO CA",
      posted: day("2026-03-06"),
    });
    expect(ids(db, { merchant: "bluebottlecoffee" })).toEqual(new Set([rows.coffee.id, other.id]));
    expect(ids(db, { merchant: "nosuchmerchant" }).size).toBe(0);
    // the override renames a transaction's merchant
    expect(ids(db, { merchant: "groceriesco" })).toEqual(new Set([rows.grocery.id]));
  });

  it("attaches tags and the display payee", () => {
    const { db, rows } = fixture();
    const page = queryTransactions(db, { q: "coffee" }, { timeZone: TZ });
    expect(page.rows[0]).toMatchObject({ id: rows.coffee.id, accountName: "chk", displayPayee: "BLUE BOTTLE COFFEE" });
    expect(page.rows[0].tags.map((t) => t.name)).toEqual(["trip"]);
    expect(queryTransactions(db, { q: "trader" }, { timeZone: TZ }).rows[0].displayPayee).toBe("Groceries Co");
  });

  it("uses the account display name when set", () => {
    const { db } = fixture();
    db.update(accounts).set({ displayName: "Everyday" }).where(eq(accounts.id, "chk")).run();
    expect(queryTransactions(db, { accountId: "chk" }, { timeZone: TZ }).rows[0].accountName).toBe("Everyday");
  });
});

describe("running balance", () => {
  function setup() {
    const db = freshDb();
    addAccount(db, "a", { balanceCents: 100_000 });
    const t = [
      addTxn(db, "a", { posted: day("2026-01-01"), amountCents: 50_000 }),
      addTxn(db, "a", { posted: day("2026-01-02"), amountCents: -2_000 }),
      addTxn(db, "a", { posted: day("2026-01-03"), amountCents: -3_000 }),
      addTxn(db, "a", { posted: day("2026-01-04"), amountCents: 10_000 }),
    ];
    return { db, t };
  }

  it("matches the bank balance on the newest row and works backwards", () => {
    const { db } = setup();
    const rows = queryTransactions(db, { accountId: "a" }, { timeZone: TZ }).rows;
    expect(rows.map((r) => r.runningBalanceCents)).toEqual([100_000, 90_000, 93_000, 95_000]);
  });

  it("is consistent across pages", () => {
    const { db } = setup();
    const p1 = queryTransactions(db, { accountId: "a" }, { limit: 2, timeZone: TZ });
    const p2 = queryTransactions(db, { accountId: "a" }, { limit: 2, cursor: p1.nextCursor, timeZone: TZ });
    expect([...p1.rows, ...p2.rows].map((r) => r.runningBalanceCents)).toEqual([100_000, 90_000, 93_000, 95_000]);
  });

  it("skips pending rows, which banks don't include in the balance", () => {
    const { db } = setup();
    addTxn(db, "a", { pending: true, posted: 0, transactedAt: day("2026-01-05"), amountCents: -700 });
    const rows = queryTransactions(db, { accountId: "a" }, { timeZone: TZ }).rows;
    expect(rows[0].pending).toBe(true);
    expect(rows[0].runningBalanceCents).toBeNull();
    expect(rows[1].runningBalanceCents).toBe(100_000);
  });

  it("is omitted when other filters are active or no account is selected", () => {
    const { db } = setup();
    expect(
      queryTransactions(db, { accountId: "a", q: "txn" }, { timeZone: TZ }).rows.every(
        (r) => r.runningBalanceCents === null,
      ),
    ).toBe(true);
    expect(queryTransactions(db, {}, { timeZone: TZ }).rows.every((r) => r.runningBalanceCents === null)).toBe(true);
  });

  it("orders same-timestamp rows by id so balances stay exact", () => {
    const db = freshDb();
    addAccount(db, "a", { balanceCents: 1000 });
    addTxn(db, "a", { posted: day("2026-01-01"), amountCents: -100 });
    addTxn(db, "a", { posted: day("2026-01-01"), amountCents: -200 });
    const rows = queryTransactions(db, { accountId: "a" }, { timeZone: TZ }).rows;
    expect(rows.map((r) => [r.amountCents, r.runningBalanceCents])).toEqual([
      [-200, 1000],
      [-100, 1200],
    ]);
  });
});

describe("detail", () => {
  it("returns raw JSON and the paired transfer", () => {
    const db = freshDb();
    addAccount(db, "a");
    addAccount(db, "b");
    const x = addTxn(db, "a", { rawJson: '{"id":"x"}', amountCents: -500 });
    const y = addTxn(db, "b", { amountCents: 500, description: "FROM A" });
    db.update(transactions).set({ transferPairId: y.id, isTransfer: true }).where(eq(transactions.id, x.id)).run();
    const d = getTransactionDetail(db, x.id)!;
    expect(d.rawJson).toBe('{"id":"x"}');
    expect(d.pair).toMatchObject({ id: y.id, accountName: "b", displayPayee: "FROM A", amountCents: 500 });
    expect(getTransactionDetail(db, 99999)).toBeUndefined();
  });
});

describe("performance", () => {
  it("serves pages from 10,000 transactions quickly", () => {
    const db = freshDb();
    addAccount(db, "a", { balanceCents: 5_000_000 });
    db.transaction((tx) => {
      for (let i = 0; i < 10_000; i++) {
        addTxn(tx as never, "a", {
          posted: 1_700_000_000 + i * 3000,
          amountCents: -(i % 500) - 1,
          description: `Merchant ${i % 97}`,
        });
      }
    });
    const t0 = performance.now();
    const first = queryTransactions(db, { accountId: "a" }, { timeZone: TZ });
    const next = queryTransactions(db, { accountId: "a" }, { cursor: first.nextCursor, timeZone: TZ });
    const searched = queryTransactions(db, { q: "merchant 42" }, { timeZone: TZ });
    const elapsed = performance.now() - t0;
    expect(first.total).toBe(10_000);
    expect(next.rows).toHaveLength(100);
    expect(searched.rows.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
  }, 30_000);
});
