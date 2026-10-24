import Database from "better-sqlite3";
import { expect, type Page } from "@playwright/test";
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
