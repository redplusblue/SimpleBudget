import { expect, test } from "@playwright/test";
import { insertConnection } from "./helpers";

test("fresh install walks through the setup wizard on mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Create your password" })).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("at least 10");

  await page.getByLabel("Password", { exact: true }).fill("a long enough password");
  await page.getByLabel("Confirm password").fill("a different password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("don't match");

  await page.getByLabel("Confirm password").fill("a long enough password");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect SimpleFIN" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Reloading resumes at the connect step; the finish button is hidden until a connection exists.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect SimpleFIN" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish setup" })).toHaveCount(0);

  await page.getByRole("textbox", { name: "Setup token" }).fill("nope!");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("doesn't look like a SimpleFIN setup token");

  insertConnection("./data/e2e-fresh.db");
  await page.reload();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
