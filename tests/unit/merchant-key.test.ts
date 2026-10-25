import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { transactions } from "@/db/schema";
import { merchantKey } from "@/lib/finance/payee";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const keyOf = (db: ReturnType<typeof freshDb>, id: number) =>
  db.select().from(transactions).where(eq(transactions.id, id)).get()!.merchantKey;

describe("merchantKey", () => {
  it("groups spelling variants and never returns an empty key", () => {
    expect(merchantKey("TRADER JOE'S #552 AUSTIN TX")).toBe(merchantKey("Trader Joe's"));
    expect(merchantKey("SQ *Blue Bottle Coffee")).toBe("bluebottlecoffee");
    expect(merchantKey("***")).toBe("unknown");
    expect(merchantKey("")).toBe("unknown");
  });
});

describe("merchant_key triggers", () => {
  it("fills the key on insert from the description", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a", { description: "SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA" });
    expect(keyOf(db, t.id)).toBe("bluebottlecoffee");
  });

  it("prefers the bank payee, then the user's override, and follows later edits", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a", { description: "AMZN MKTP US*2K4", payee: "Amazon" });
    expect(keyOf(db, t.id)).toBe("amazon");
    db.update(transactions).set({ payeeOverride: "  My Shop " }).where(eq(transactions.id, t.id)).run();
    expect(keyOf(db, t.id)).toBe("myshop");
    db.update(transactions).set({ payeeOverride: null }).where(eq(transactions.id, t.id)).run();
    expect(keyOf(db, t.id)).toBe("amazon");
    db.update(transactions)
      .set({ payeeOverride: "   ", payee: null, description: "NETFLIX.COM" })
      .where(eq(transactions.id, t.id))
      .run();
    expect(keyOf(db, t.id)).toBe("netflixcom");
  });

  it("is untouched by edits to unrelated columns", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a", { description: "SHELL OIL 57444 AUSTIN TX" });
    db.update(transactions).set({ notes: "gas", amountCents: -1 }).where(eq(transactions.id, t.id)).run();
    expect(keyOf(db, t.id)).toBe("shelloil");
  });

  it("works for inserts of many rows at once", () => {
    const db = freshDb();
    addAccount(db, "a");
    const rows = Array.from({ length: 50 }, (_, i) => addTxn(db, "a", { description: `MERCHANT ${i % 5} #${i}` }));
    expect(new Set(rows.map((r) => keyOf(db, r.id)))).toEqual(
      new Set(["merchant0", "merchant1", "merchant2", "merchant3", "merchant4"]),
    );
  });

  it("backfills rows that existed before the migration (via the same SQL function)", () => {
    const db = freshDb();
    addAccount(db, "a");
    const t = addTxn(db, "a", { description: "HULU 877-824-4858 CA" });
    db.run(sqlNull(t.id));
    expect(keyOf(db, t.id)).toBeNull();
    db.run(backfillSql());
    expect(keyOf(db, t.id)).toBe("hulu");
  });
});

import { sql } from "drizzle-orm";
const sqlNull = (id: number) => sql`UPDATE transactions SET merchant_key = NULL WHERE id = ${id}`;
const backfillSql = () =>
  sql`UPDATE transactions SET merchant_key = payee_key(coalesce(nullif(trim(payee_override), ''), nullif(trim(payee), ''), description)) WHERE merchant_key IS NULL`;

describe("upgrading an existing database", () => {
  it("backfills merchant keys for rows created before the migration", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { createDb, openSqlite } = await import("@/db/open");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const full = path.resolve(import.meta.dirname, "../../drizzle");

    // A migrations folder that stops at 0000, as an older install would have applied.
    const old = fs.mkdtempSync(path.join(os.tmpdir(), "sb-mig-"));
    fs.mkdirSync(path.join(old, "meta"));
    fs.copyFileSync(path.join(full, "0000_init.sql"), path.join(old, "0000_init.sql"));
    const journal = JSON.parse(fs.readFileSync(path.join(full, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 1);
    fs.writeFileSync(path.join(old, "meta/_journal.json"), JSON.stringify(journal));

    const sqlite = openSqlite(":memory:");
    const db = createDb(sqlite);
    migrate(db, { migrationsFolder: old });
    sqlite.exec(`INSERT INTO accounts (id, org_name, name) VALUES ('a', 'Bank', 'A')`);
    sqlite.exec(`INSERT INTO transactions (account_id, sf_txn_id, posted, amount_cents, description, raw_json) VALUES
      ('a', '1', 1, -100, 'TRADER JOE''S #552 AUSTIN TX', '{}'), ('a', '2', 2, -100, 'SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA', '{}')`);

    migrate(db, { migrationsFolder: full });
    expect(sqlite.prepare("SELECT merchant_key FROM transactions ORDER BY id").all()).toEqual([
      { merchant_key: "traderjoes" },
      { merchant_key: "bluebottlecoffee" },
    ]);
    // and the triggers are live for new rows
    sqlite.exec(
      `INSERT INTO transactions (account_id, sf_txn_id, posted, amount_cents, description, raw_json) VALUES ('a', '3', 3, -1, 'HULU 877-824-4858 CA', '{}')`,
    );
    expect(sqlite.prepare("SELECT merchant_key FROM transactions WHERE sf_txn_id = '3'").get()).toEqual({
      merchant_key: "hulu",
    });
  });
});
