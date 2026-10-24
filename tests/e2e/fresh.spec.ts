import { expect, test } from "@playwright/test";
import { insertConnection, MOCK_PORT, expectNoHorizontalOverflow } from "./helpers";

test("fresh install walks through the whole setup wizard on mobile", async ({ page }) => {
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
  // The four-step indicator must fit inside a 390px screen.
  const box = (await page.getByRole("list", { name: "Setup progress" }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalOverflow(page);

  // Reloading resumes at the connect step.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect SimpleFIN" })).toBeVisible();

  await page.getByRole("textbox", { name: "Setup token" }).fill("nope!");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("doesn't look like a SimpleFIN setup token");

  // Claiming a real token needs HTTPS, so stand in for it with a connection to the local mock bank.
  insertConnection("./data/e2e-fresh.db", `http://e2e:secret@127.0.0.1:${MOCK_PORT}/simplefin`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Import your history" })).toBeVisible();
  await expect(page.getByText(/uses 2 of your 20 daily/)).toBeVisible(); // 90 days = two 60-day windows
  await page.getByRole("radio", { name: "30 days" }).click();
  await expect(page.getByText(/uses 1 of your 20 daily/)).toBeVisible();
  await page.getByRole("button", { name: "Start import" }).click();

  await expect(page.getByRole("heading", { name: "Confirm your accounts" })).toBeVisible({ timeout: 20_000 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText("Total Checking")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Type of Sapphire Credit Card" })).toHaveText("Credit card");
  await expect(page.getByRole("combobox", { name: "Type of High Yield Savings" })).toHaveText("Savings");

  // Changing a type persists.
  await page.getByRole("combobox", { name: "Type of Total Checking" }).click();
  await page.getByRole("option", { name: "Cash" }).click();
  await expect(page.getByRole("combobox", { name: "Type of Total Checking" })).toHaveText("Cash");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Type of Total Checking" })).toHaveText("Cash");

  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Synced .* ago/ })).toBeVisible();
});
