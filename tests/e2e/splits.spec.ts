import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, insertExpense } from "./helpers";

// Shares the "targets" project's seeded server (adds one transaction with a unique name).
const DB = "./data/e2e-targets.db";
test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("split a purchase across two categories, then replace it with a single category", async ({ page }) => {
  const id = insertExpense(DB, { accountId: "fake-checking", description: "E2E SPLIT STORE", dollars: 100 });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions?q=E2E%20SPLIT%20STORE");
  await page.getByTestId("txn-row").filter({ hasText: "E2E SPLIT STORE" }).click();

  await page.getByRole("button", { name: "Split across categories" }).click();
  const editor = page.getByTestId("split-editor");
  await expectNoHorizontalOverflow(page);
  await pick(page, "Category for part 1", "Groceries");
  await editor.getByLabel("Amount for part 1").fill("70");
  await pick(page, "Category for part 2", "Shopping");
  await editor.getByLabel("Amount for part 2").fill("20");
  await expect(page.getByTestId("split-remaining")).toContainText("$10.00");
  await expect(page.getByTestId("split-remaining")).toContainText("left to assign");
  await expect(editor.getByRole("button", { name: "Save split" })).toBeDisabled();

  await editor.getByLabel("Amount for part 2").fill("40");
  await expect(page.getByTestId("split-remaining")).toContainText("$10.00");
  await expect(page.getByTestId("split-remaining")).toContainText("too much");
  await expect(editor.getByRole("button", { name: "Save split" })).toBeDisabled();
  await editor.getByLabel("Amount for part 2").fill("30");
  await expect(page.getByTestId("split-remaining")).toContainText("Adds up to the full amount");
  await editor.getByRole("button", { name: "Save split" }).click();

  const summary = page.getByTestId("split-summary");
  await expect(summary).toContainText("Groceries");
  await expect(summary).toContainText("-$70.00");
  await expect(summary).toContainText("Shopping");
  await expect(summary).toContainText("-$30.00");
  const api = await (await page.request.get(`/api/transactions/${id}/splits`)).json();
  expect(api.splits.map((p: { amountCents: number }) => p.amountCents)).toEqual([-7000, -3000]);

  // The register row now says it is split.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("txn-row").filter({ hasText: "E2E SPLIT STORE" })).toContainText("Split (2)");

  // The Shopping category now includes this purchase, and "uncategorized" no longer does.
  const cats = (await (await page.request.get("/api/categories")).json()) as {
    categories: Array<{ id: number; name: string }>;
  };
  const shopping = cats.categories.find((c) => c.name === "Shopping")!.id;
  const shoppingRows = await (
    await page.request.get(`/api/transactions?category=${shopping}&q=E2E%20SPLIT%20STORE`)
  ).json();
  expect(shoppingRows.rows.map((r: { id: number }) => r.id)).toContain(id);
  const noneRows = await (await page.request.get("/api/transactions?category=none&q=E2E%20SPLIT%20STORE")).json();
  expect(noneRows.rows).toHaveLength(0);

  // Picking one category replaces the split.
  await page.getByTestId("txn-row").filter({ hasText: "E2E SPLIT STORE" }).click();
  await pick(page, "Category", "Dining");
  await expect(page.getByTestId("split-summary")).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get(`/api/transactions/${id}/splits`)).json()).splits.length)
    .toBe(0);
});

test("the server refuses a split that doesn't add up", async ({ page }) => {
  const id = insertExpense(DB, { accountId: "fake-checking", description: "E2E SPLIT BAD", dollars: 50 });
  await login(page);
  const res = await page.request.put(`/api/transactions/${id}/splits`, {
    data: {
      parts: [
        { categoryId: null, amountCents: -3000 },
        { categoryId: null, amountCents: -1000 },
      ],
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).message).toContain("short by 10.00");
});
