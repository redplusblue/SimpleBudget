import { expectNoHorizontalOverflow } from "./helpers";
import { expect, test } from "@playwright/test";

test("sync pill shows the last sync and the imported data is reachable via the API", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Synced .* ago\. Sync details/ })).toBeVisible();

  const { accounts } = await (await request.get("/api/accounts")).json();
  expect(accounts.map((a: { name: string }) => a.name).sort()).toEqual([
    "High Yield Savings",
    "Sapphire Credit Card",
    "Total Checking",
  ]);
  const types = Object.fromEntries(accounts.map((a: { name: string; type: string }) => [a.name, a.type]));
  expect(types).toMatchObject({
    "Sapphire Credit Card": "credit",
    "High Yield Savings": "savings",
    "Total Checking": "checking",
  });
});

test("pill popover shows request usage and links to sync settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Sync details/ }).click();
  await expect(page.getByText(/SimpleFIN requests used today/)).toBeVisible();
  await page.getByRole("link", { name: /Sync history/ }).click();
  await expect(page).toHaveURL(/\/settings\/sync$/);
});

test("settings: history lists the seed import; schedule is editable", async ({ page, isMobile }) => {
  await page.goto("/settings/sync");
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  // The seed import added 22 transactions (cells render as "OK" then "22"); other runs may follow it.
  await expect(page.getByRole("row").filter({ hasText: /OK22/ }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("combobox", { name: "Schedule" }).click();
  await page.getByRole("option", { name: "Every 12 hours" }).click();
  await expect(page.getByRole("combobox", { name: "Schedule" })).toHaveText("Every 12 hours");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Schedule" })).toHaveText("Every 12 hours");
  await page.getByRole("combobox", { name: "Schedule" }).click();
  await page.getByRole("option", { name: "Every 6 hours" }).click();
  void isMobile;
});

test("manual sync runs once, then the 15 minute cooldown applies", async ({ page, request, isMobile }) => {
  test.skip(isMobile, "the cooldown is global to the seeded install; one project exercises it");
  await page.goto("/settings/sync");
  await page.getByRole("main").getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: /Sync in \d+ min/ })).toBeVisible({
    timeout: 15_000,
  });
  const second = await request.post("/api/sync");
  expect(second.status()).toBe(429);
  expect(Number(second.headers()["retry-after"])).toBeGreaterThan(0);
  await expect(page.getByRole("row").filter({ hasText: "OK" })).not.toHaveCount(0);
});
