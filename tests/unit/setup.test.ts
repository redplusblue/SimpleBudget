import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { deleteSetting, getSetting, setSetting, SETTING_KEYS } from "@/lib/settings";
import { completeSetup, createInitialPassword, getSetupState } from "@/lib/setup";
import { connections } from "@/db/schema";

function freshDb() {
  const db = createDb(openSqlite(":memory:"));
  runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
  return db;
}

describe("settings + setup state", () => {
  it("upserts and deletes settings", () => {
    const db = freshDb();
    expect(getSetting(db, "k")).toBeUndefined();
    setSetting(db, "k", "1");
    setSetting(db, "k", "2");
    expect(getSetting(db, "k")).toBe("2");
    deleteSetting(db, "k");
    expect(getSetting(db, "k")).toBeUndefined();
  });

  it("progresses needs-password → needs-connection → complete", () => {
    const db = freshDb();
    expect(getSetupState(db)).toBe("needs-password");
    setSetting(db, SETTING_KEYS.passwordHash, "hash");
    expect(getSetupState(db)).toBe("needs-connection");
    setSetting(db, SETTING_KEYS.setupComplete, "1");
    expect(getSetupState(db)).toBe("complete");
  });
});

describe("createInitialPassword / completeSetup", () => {
  it("only the first password write wins", () => {
    const db = freshDb();
    expect(createInitialPassword(db, "h1")).toBe(true);
    expect(createInitialPassword(db, "h2")).toBe(false);
    expect(getSetting(db, SETTING_KEYS.passwordHash)).toBe("h1");
  });

  it("completeSetup requires a connection", () => {
    const db = freshDb();
    expect(completeSetup(db)).toBe("no-connection");
    expect(getSetupState(db)).toBe("needs-password");
    db.insert(connections).values({ orgName: "SimpleFIN" }).run();
    expect(completeSetup(db)).toBe("ok");
    expect(getSetting(db, SETTING_KEYS.setupComplete)).toBe("1");
  });
});
