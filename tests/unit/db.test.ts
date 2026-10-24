import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { categories } from "@/db/schema";

const folder = path.resolve(import.meta.dirname, "../../drizzle");

describe("migrations", () => {
  it("apply to a fresh database and seed categories exactly once", () => {
    const db = createDb(openSqlite(":memory:"));
    runMigrations(db, folder);
    expect(db.select().from(categories).all()).toHaveLength(15);
    runMigrations(db, folder);
    expect(db.select().from(categories).all()).toHaveLength(15);
  });

  it("does not re-seed after the user deletes every category", () => {
    const db = createDb(openSqlite(":memory:"));
    runMigrations(db, folder);
    db.delete(categories).run();
    runMigrations(db, folder);
    expect(db.select().from(categories).all()).toHaveLength(0);
  });
});
