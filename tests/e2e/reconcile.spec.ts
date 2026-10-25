import { expect, test, type Page } from "@playwright/test";

// Shares the "targets" project's seeded server.
test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("reconcile: a wrong balance shows the difference, a right one can be signed off", async ({ page }) => {
  await login(page);
  const detail = await (await page.request.get("/api/accounts/fake-savings")).json();
  const balance = (detail.account.balanceCents as number) / 100;

  await page.goto("/accounts/fake-savings");
  await page.getByRole("button", { name: "Reconcile" }).click();
  await page.getByLabel("Bank says ($)").fill((balance + 25).toFixed(2));
  await page.getByRole("button", { name: "Check", exact: true }).click();
  const result = page.getByTestId("reconcile-result");
  await expect(result).toContainText("Off by");
  await expect(result).toContainText("$25.00");
  await expect(result).toContainText("the bank has more");
  await expect(page.getByRole("button", { name: /^Mark \d+ reviewed/ })).toHaveCount(0);

  await page.getByLabel("Bank says ($)").fill(balance.toFixed(2));
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(result).toContainText("They match.");
  const mark = page.getByRole("button", { name: /^Mark \d+ reviewed/ });
  await mark.click();
  await expect(page.getByText(/Marked \d+ transactions? reviewed/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mark \d+ reviewed/ })).toHaveCount(0);

  const unreviewed = await (await page.request.get("/api/transactions?account=fake-savings&status=unreviewed")).json();
  expect(unreviewed.rows).toHaveLength(0);
});
