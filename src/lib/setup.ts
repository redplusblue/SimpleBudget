import type { Db } from "@/db/open";
import { connections, settings } from "@/db/schema";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";

export type SetupState = "needs-password" | "needs-connection" | "complete";

/** Where a fresh install stands: no password yet, password but setup unfinished, or done. */
export function getSetupState(db: Db): SetupState {
  if (!getSetting(db, SETTING_KEYS.passwordHash)) return "needs-password";
  if (getSetting(db, SETTING_KEYS.setupComplete) !== "1") return "needs-connection";
  return "complete";
}

/**
 * Stores the initial password hash. Returns false when a password already exists; the
 * insert is a single atomic statement, so two concurrent first-run requests can't both win.
 */
export function createInitialPassword(db: Db, hash: string): boolean {
  const res = db.insert(settings).values({ key: SETTING_KEYS.passwordHash, value: hash }).onConflictDoNothing().run();
  return res.changes === 1;
}

/** Marks setup finished; requires at least one SimpleFIN connection. */
export function completeSetup(db: Db): "ok" | "no-connection" {
  const hasConnection = db.select({ id: connections.id }).from(connections).limit(1).get();
  if (!hasConnection) return "no-connection";
  setSetting(db, SETTING_KEYS.setupComplete, "1");
  return "ok";
}
