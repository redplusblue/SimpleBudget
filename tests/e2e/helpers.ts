import Database from "better-sqlite3";

export const PASSWORD = "e2e correct horse battery";

/** Inserts a bare connection row, standing in for a claimed SimpleFIN token (claiming needs real HTTPS). */
export function insertConnection(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare(
      "insert into connections (org_name, last_error) values ('Test Bank', 'Re-authenticate with your bank')",
    ).run();
  } finally {
    db.close();
  }
}
