import Database from "better-sqlite3";
import { expect, type Page } from "@playwright/test";
import { merchantKey } from "../../src/lib/finance/payee";
import { createSecretBox } from "../../src/lib/secret-box";

export const PASSWORD = "e2e correct horse battery";
export const E2E_SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e";
export const MOCK_PORT = 3199;

/**
 * Stands in for claiming a setup token (which needs real HTTPS): inserts a connection whose
 * encrypted access URL points at the local mock SimpleFIN server.
 */
export function insertConnection(dbPath: string, accessUrl: string) {
  const db = new Database(dbPath);
  try {
    db.pragma("busy_timeout = 5000");
    const { lastInsertRowid } = db.prepare("insert into connections (org_name) values ('SimpleFIN')").run();
    db.prepare("insert into settings (key, value) values (?, ?)").run(
      `access_url:${lastInsertRowid}`,
      createSecretBox(E2E_SECRET).encrypt(accessUrl),
    );
  } finally {
    db.close();
  }
}

/**
 * The page must fit the *configured* viewport. Comparing against `window.innerWidth` isn't enough: on mobile
 * emulation, overflowing content makes the browser widen the layout viewport, which hides the very bug.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${width}px viewport`).toBeLessThanOrEqual(width);
}

let counter = 0;

export interface ExpenseSeed {
  accountId: string;
  description: string;
  /** Positive dollars spent. */
  dollars: number;
  categoryId?: number;
  tagIds?: number[];
  /** Seconds before now (default 60). */
  secondsAgo?: number;
}

/**
 * Inserts an expense straight into a test database (there is no manual-transaction UI yet), returning its id.
 * The merchant_key triggers call payee_key(), so the function is registered on this connection too.
 */
export function insertExpense(dbPath: string, e: ExpenseSeed): number {
  const db = new Database(dbPath);
  try {
    db.pragma("busy_timeout = 5000");
    db.function("payee_key", { deterministic: true }, (raw) => merchantKey(typeof raw === "string" ? raw : ""));
    const posted = Math.floor(Date.now() / 1000) - (e.secondsAgo ?? 60);
    const { lastInsertRowid } = db
      .prepare(
        "insert into transactions (account_id, sf_txn_id, posted, amount_cents, description, category_id, raw_json) values (?, ?, ?, ?, ?, ?, '{}')",
      )
      .run(
        e.accountId,
        `e2e-seed-${Date.now()}-${++counter}`,
        posted,
        -Math.round(e.dollars * 100),
        e.description,
        e.categoryId ?? null,
      );
    for (const tagId of e.tagIds ?? [])
      db.prepare("insert into transaction_tags (transaction_id, tag_id) values (?, ?)").run(lastInsertRowid, tagId);
    return Number(lastInsertRowid);
  } finally {
    db.close();
  }
}
