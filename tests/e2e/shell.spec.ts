import { expect, test } from "@playwright/test";

test("shell renders and navigates", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary" }).filter({ visible: true });
  await nav.getByRole("link", { name: "Spending" }).click();
  await expect(page).toHaveURL(/\/spending$/);
  await expect(page.getByRole("heading", { name: "Spending" })).toBeVisible();
});

test("theme choice persists across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Change theme" }).click();
  await page.getByRole("menuitem", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("no horizontal overflow", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("health endpoint", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
});
