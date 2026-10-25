import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

// Shares the "targets" project's seeded server.
test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("a cash account: create, add and edit transactions, set the balance, delete", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/accounts");

  await page.getByRole("button", { name: "Add manual account" }).click();
  await page.getByLabel("Name").fill("E2E Wallet");
  await page.getByLabel(/Current balance/).fill("200");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page).toHaveURL(/\/accounts\/manual-/);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Wallet" })).toBeVisible();
  await expect(page.getByText("Manual account")).toBeVisible();
  await expect(page.getByText("$200.00").first()).toBeVisible();
  await expect(page.getByText(/balance is from|hasn't reported/)).toHaveCount(0); // never "stale"

  // Add a purchase: the balance follows.
  await page.getByRole("button", { name: "Add transaction" }).click();
  await page.getByLabel("Amount ($)").fill("23.50");
  await page.getByLabel("Description").fill("E2E taco truck");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  const row = page.getByTestId("txn-row").filter({ hasText: "E2E taco truck" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$23.50");
  await expect(page.getByText("$176.50").first()).toBeVisible();

  // Edit it from the drawer.
  await row.click();
  await expect(page.getByRole("region", { name: "Added by hand" })).toBeVisible();
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Amount ($)").fill("30");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Transaction updated")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("$170.00").first()).toBeVisible();

  // Count the cash and correct the balance.
  await page.getByRole("button", { name: "Account settings" }).click();
  await page.getByLabel(/^Balance/).fill("150");
  await page.getByRole("button", { name: "Set balance" }).click();
  await expect(page.getByText("Balance updated")).toBeVisible();
  await expect(page.getByText("$150.00").first()).toBeVisible();

  // Delete the transaction: the balance gets its amount back.
  await page.getByTestId("txn-row").filter({ hasText: "E2E taco truck" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete it" }).click();
  await expect(page.getByText("Transaction deleted")).toBeVisible();
  await expect(page.getByTestId("txn-row").filter({ hasText: "E2E taco truck" })).toHaveCount(0);
  await expect(page.getByText("$180.00").first()).toBeVisible();

  // Delete the account.
  await page.getByRole("button", { name: "Account settings" }).click();
  await page.getByRole("button", { name: "Delete account…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByText("E2E Wallet")).toHaveCount(0);
});

test("synced accounts can't be changed through the manual endpoints", async ({ page }) => {
  await login(page);
  expect((await page.request.put("/api/accounts/fake-checking/balance", { data: { balanceCents: 1 } })).status()).toBe(
    400,
  );
  expect((await page.request.delete("/api/accounts/fake-checking")).status()).toBe(400);
  const add = await page.request.post("/api/accounts/fake-checking/transactions", {
    data: { date: "2026-10-01", amountCents: -100, description: "x" },
  });
  expect(add.status()).toBe(400);
});
