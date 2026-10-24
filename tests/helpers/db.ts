import path from "node:path";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite, type Db } from "@/db/open";
import { accounts, categories, tags, transactions } from "@/db/schema";

export function freshDb(): Db {
  const db = createDb(openSqlite(":memory:"));
  runMigrations(db, path.resolve(__dirname, "../../drizzle"));
  return db;
}

export function addAccount(db: Db, id: string, over: Partial<typeof accounts.$inferInsert> = {}) {
  db.insert(accounts)
    .values({ id, orgName: "Bank", name: id, balanceCents: 0, type: "checking", ...over })
    .run();
}

let seq = 0;
export function addTxn(db: Db, accountId: string, over: Partial<typeof transactions.$inferInsert> = {}) {
  const n = ++seq;
  return db
    .insert(transactions)
    .values({
      accountId,
      sfTxnId: `t${n}`,
      posted: 1_700_000_000 + n * 60,
      amountCents: -1000,
      description: `Txn ${n}`,
      rawJson: "{}",
      ...over,
    })
    .returning()
    .get();
}

export const categoryId = (db: Db, name: string) =>
  db
    .select()
    .from(categories)
    .all()
    .find((c) => c.name === name)!.id;
export const addTag = (db: Db, name: string, color = "#6366F1") =>
  db.insert(tags).values({ name, color }).returning().get();
