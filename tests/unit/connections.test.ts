import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { accounts, settings, transactions } from "@/db/schema";
import { addConnection, getAccessUrl, listConnections, removeConnection } from "@/lib/connections";

const ACCESS = "https://user:topsecret@bridge.simplefin.org/simplefin";

function freshDb() {
  const db = createDb(openSqlite(":memory:"));
  runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
  return db;
}

function seedAccount(db: ReturnType<typeof freshDb>, connectionId: number, id: string) {
  db.insert(accounts).values({ id, connectionId, orgName: "Bank", name: "Checking" }).run();
  db.insert(transactions)
    .values({ accountId: id, sfTxnId: "t1", posted: 1, amountCents: -100, description: "x", rawJson: "{}" })
    .run();
}

describe("connections", () => {
  it("stores the access URL encrypted and can read it back", () => {
    const db = freshDb();
    const id = addConnection(db, ACCESS);
    const stored = db
      .select()
      .from(settings)
      .all()
      .find((s) => s.key === `access_url:${id}`)!;
    expect(stored.value).not.toContain("topsecret");
    expect(stored.value.startsWith("v1:")).toBe(true);
    expect(getAccessUrl(db, id)).toBe(ACCESS);
  });

  it("lists connections with account counts and no credentials", () => {
    const db = freshDb();
    const a = addConnection(db, ACCESS);
    addConnection(db, ACCESS);
    seedAccount(db, a, "acc1");
    const list = listConnections(db);
    expect(list.map((c) => c.accountCount)).toEqual([1, 0]);
    expect(JSON.stringify(list)).not.toContain("topsecret");
  });

  it("removing with deleteData wipes accounts and transactions", () => {
    const db = freshDb();
    const id = addConnection(db, ACCESS);
    seedAccount(db, id, "acc1");
    expect(removeConnection(db, id, { deleteData: true })).toBe(true);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(transactions).all()).toHaveLength(0);
    expect(getAccessUrl(db, id)).toBeUndefined();
  });

  it("removing without deleteData keeps accounts, detached, and still drops credentials", () => {
    const db = freshDb();
    const id = addConnection(db, ACCESS);
    seedAccount(db, id, "acc1");
    expect(removeConnection(db, id, { deleteData: false })).toBe(true);
    const acc = db.select().from(accounts).all();
    expect(acc).toHaveLength(1);
    expect(acc[0].connectionId).toBeNull();
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(getAccessUrl(db, id)).toBeUndefined();
  });

  it("returns false for unknown connections", () => {
    expect(removeConnection(freshDb(), 99, { deleteData: true })).toBe(false);
  });
});
