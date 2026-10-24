import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./open";
import { seedDefaultCategories } from "./seed";

export function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle");
}

/** Applies pending migrations, then seeds default categories once on a fresh database. */
export function runMigrations(db: Db, folder = migrationsFolder()) {
  migrate(db, { migrationsFolder: folder });
  seedDefaultCategories(db);
}
