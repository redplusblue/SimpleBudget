import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "@/db/open";

/**
 * A consistent copy of the whole database (`VACUUM INTO`, safe while the app is running) as bytes.
 * It contains your data and the encrypted bank access URL, so treat the file like a password.
 */
export function createBackup(db: Db): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simplebudget-backup-"));
  const file = path.join(dir, "backup.sqlite");
  try {
    db.$client.prepare("VACUUM INTO ?").run(file);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
