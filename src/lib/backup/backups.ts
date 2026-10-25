import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/db/open";

export const KEEP_BACKUPS = 14;
const NAME = /^simplebudget-\d{8}-\d{6}\.sqlite$/;

export interface BackupFile {
  name: string;
  sizeBytes: number;
  /** Unix seconds. */
  createdAt: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `simplebudget-YYYYMMDD-HHMMSS.sqlite` in UTC, so names sort in time order. */
export function backupName(now: number): string {
  const d = new Date(now * 1000);
  return `simplebudget-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.sqlite`;
}

export function listBackups(dir: string): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, sizeBytes: st.size, createdAt: Math.floor(st.mtimeMs / 1000) };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first
}

/** Deletes all but the newest `keep` backups. Only files this module named are ever touched. */
export function pruneBackups(dir: string, keep = KEEP_BACKUPS): string[] {
  const doomed = listBackups(dir).slice(keep);
  for (const f of doomed) fs.rmSync(path.join(dir, f.name), { force: true });
  return doomed.map((f) => f.name);
}

/** Writes a consistent copy of the database into `dir` (VACUUM INTO) and prunes old ones. */
export function runBackup(db: Db, dir: string, now: number, keep = KEEP_BACKUPS): BackupFile {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = backupName(now);
  const final = path.join(dir, name);
  const tmp = `${final}.partial`;
  fs.rmSync(tmp, { force: true });
  fs.rmSync(final, { force: true }); // two backups within one second keep the later one
  db.$client.prepare("VACUUM INTO ?").run(tmp);
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, final); // a half-written file never looks like a backup
  pruneBackups(dir, keep);
  const st = fs.statSync(final);
  return { name, sizeBytes: st.size, createdAt: now };
}
