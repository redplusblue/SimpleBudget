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

/**
 * Heavy cards mount when they scroll near the screen (LazyMount). Brings each placeholder into view in turn (the page
 * grows as cards load, so it keeps looking) until none is left, then returns to the top.
 */
export async function revealLazy(page: Page) {
  for (let i = 0; i < 60; i++) {
    const pending = await page.evaluate(() => {
      const el = document.querySelector('[data-lazy="pending"]');
      el?.scrollIntoView({ block: "center" });
      return !!el;
    });
    if (!pending) break;
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
}

/** Adds a hand-kept account in another currency straight into a test database (there's no UI for currencies yet). */
export function insertForeignAccount(
  dbPath: string,
  a: { id: string; name: string; currency: string; balanceCents: number },
) {
  const db = new Database(dbPath);
  try {
    db.pragma("busy_timeout = 5000");
    db.prepare(
      "insert into accounts (id, org_name, name, currency, balance_cents, balance_date, type, is_manual) values (?, 'Manual', ?, ?, ?, unixepoch(), 'checking', 1)",
    ).run(a.id, a.name, a.currency, a.balanceCents);
    db.prepare("insert into balance_snapshots (account_id, date, balance_cents) values (?, date('now'), ?)").run(
      a.id,
      a.balanceCents,
    );
  } finally {
    db.close();
  }
}
