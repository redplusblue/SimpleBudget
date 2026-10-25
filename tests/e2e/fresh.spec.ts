import { expect, test } from "@playwright/test";
import { insertConnection, MOCK_PORT, expectNoHorizontalOverflow, revealLazy } from "./helpers";

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

  // The dashboard has real numbers from the mock bank.
  await revealLazy(page);
  await expect(page.getByRole("heading", { name: "Net worth" })).toBeVisible();
  await expect(page.getByTestId("assets-liabilities")).toBeVisible();

  // Put an expense in a category, rename that category in settings, and the new name shows on the Spending page.
  const expense = (await (await page.request.get("/api/transactions?type=expense&limit=1")).json()).rows[0] as {
    id: number;
    effectiveDate: number;
  };
  const cats = (await (await page.request.get("/api/categories")).json()).categories as Array<{
    id: number;
    name: string;
  }>;
  const dining = cats.find((c) => c.name === "Dining")!;
  expect((await page.request.patch(`/api/transactions/${expense.id}`, { data: { categoryId: dining.id } })).ok()).toBe(
    true,
  );

  await page.goto("/settings/categories");
  await page.getByRole("button", { name: "Actions for Dining" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Eating out");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("category-row").filter({ hasText: "Eating out" })).toBeVisible();

  const day = new Date(expense.effectiveDate * 1000).toISOString().slice(0, 10);
  await page.goto(`/spending?from=${day}&to=${day}`);
  await revealLazy(page);
  await expect(page.getByTestId("category-table")).toContainText("Eating out");
  await expectNoHorizontalOverflow(page);
});
