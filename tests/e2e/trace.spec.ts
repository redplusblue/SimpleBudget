import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

// Shares the "targets" project's 10,000-transaction install. Trace history is computed locally: no AI needed.
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("Trace history shows a merchant's whole history, with a chart, and fits a phone", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  await login(page);
  await page.goto("/transactions");
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("blue bottle");
  await expect(page).toHaveURL(/q=blue%20bottle|q=blue\+bottle/);
  const row = page.getByTestId("txn-row").first();
  await expect(row).toBeVisible();
  await row.click();

  await page.getByRole("button", { name: "Trace history" }).click();
  const panel = page.getByTestId("trace-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("trace-count")).toHaveText(/\d+ transactions since \d{4}-\d{2}-\d{2}/);
  await expect(panel.getByText("Total spent")).toBeVisible();
  await expect(panel.getByText("Typical charge")).toBeVisible();
  await expect(page.getByTestId("trace-chart")).toBeVisible();
  await expect(panel.getByRole("link", { name: /See all \d+ transactions/ })).toBeVisible();
  await expect(panel.getByText(/Covered by rule|No rule covers this merchant/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("trace-panel")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(problems).toEqual([]);
});

test("the trace API works for any transaction and 404s for a missing one", async ({ page }) => {
  await login(page);
  const list = await (await page.request.get("/api/transactions?limit=1")).json();
  const id = list.rows[0].id as number;
  const res = await page.request.get(`/api/transactions/${id}/trace`);
  expect(res.status()).toBe(200);
  const { trace } = await res.json();
  expect(trace.transactionId).toBe(id);
  expect(trace.byMonth).toHaveLength(24);
  expect((await page.request.get("/api/transactions/99999999/trace")).status()).toBe(404);
});
