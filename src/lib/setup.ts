import type { Db } from "@/db/open";
import { getSetting, SETTING_KEYS } from "./settings";

export type SetupState = "needs-password" | "needs-connection" | "complete";

/** Where a fresh install stands: no password yet, password but setup unfinished, or done. */
export function getSetupState(db: Db): SetupState {
  if (!getSetting(db, SETTING_KEYS.passwordHash)) return "needs-password";
  if (getSetting(db, SETTING_KEYS.setupComplete) !== "1") return "needs-connection";
  return "complete";
}
