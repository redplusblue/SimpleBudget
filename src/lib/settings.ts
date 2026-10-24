import { eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { settings } from "@/db/schema";

export const SETTING_KEYS = {
  passwordHash: "password_hash",
  setupComplete: "setup_complete",
  /** Per-connection encrypted SimpleFIN access URL: `access_url:<connectionId>`. */
  accessUrlPrefix: "access_url:",
} as const;

export function getSetting(db: Db, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
