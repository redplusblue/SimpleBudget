import "server-only";
import { getEnv } from "@/lib/env";
import { runMigrations } from "./migrate";
import { createDb, openSqlite, type Db } from "./open";

const globalForDb = globalThis as unknown as { __sbDb?: Db };

/** Process-wide singleton; migrations run the first time it's opened. */
export function getDb(): Db {
  if (!globalForDb.__sbDb) {
    const db = createDb(openSqlite(getEnv().DATABASE_PATH));
    runMigrations(db);
    globalForDb.__sbDb = db;
  }
  return globalForDb.__sbDb;
}
