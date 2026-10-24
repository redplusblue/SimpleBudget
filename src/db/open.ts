import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
/** Either the database or a transaction handle; helpers that may run inside `db.transaction` take this. */
export type DbLike = BaseSQLiteDatabase<"sync", Database.RunResult, typeof schema>;

/** Opens (creating directories as needed) a SQLite file with the pragmas the app relies on. */
export function openSqlite(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  return sqlite;
}

export function createDb(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}
