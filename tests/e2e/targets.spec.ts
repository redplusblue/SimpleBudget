import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, insertExpense, revealLazy } from "./helpers";

// Runs against its own 10k-transaction install (see the "targets" project): it adds transactions and targets.
const DB = "./data/e2e-targets.db";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function newTag(page: Page, name: string) {
  const res = await page.request.post("/api/tags", { data: { name } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).tag.id as number;
}

// One test at a time: the first asserts there are no targets yet.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => login(page));

test("no targets: nothing about targets on the dashboard or Spending page", async ({ page }) => {
  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.locator("#targets")).toHaveCount(0);
  await page.goto("/spending");
  await expect(page.getByRole("heading", { level: 1, name: "Spending" })).toBeVisible();
  await expect(page.locator("#targets")).toHaveCount(0);
});

test("a tag target goes ok -> warning -> over as spending grows, and drills into the register", async ({ page }) => {
  const tagId = await newTag(page, "e2e-trip");
  const create = await page.request.post("/api/targets", {
    data: { kind: "tag", subjectId: tagId, amountCents: 10_000 },
  });
  expect(create.status()).toBe(201);
  const dup = await page.request.post("/api/targets", { data: { kind: "tag", subjectId: tagId, amountCents: 5_000 } });
  expect(dup.status()).toBe(409);

  const row = () => page.getByTestId("target-row").filter({ hasText: "e2e-trip" });
  insertExpense(DB, { accountId: "fake-checking", description: "E2E TRIP A", dollars: 50, tagIds: [tagId] });
  await page.goto("/");
  await revealLazy(page);
  await expect(row()).toContainText("50%");
  await expect(row().getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

  insertExpense(DB, { accountId: "fake-checking", description: "E2E TRIP B", dollars: 35, tagIds: [tagId] });
  await page.reload();
  await expect(row()).toContainText("85%");
  await expect(row()).toContainText("Close to the limit");

  insertExpense(DB, { accountId: "fake-checking", description: "E2E TRIP C", dollars: 30, tagIds: [tagId] });
  await page.reload();
  await expect(row()).toContainText("115%");
  await expect(row()).toContainText("Over by");
  await expect(row()).toContainText("Over the target");

  // The Spending page shows it too, and the row opens the matching register.
  await page.goto("/spending");
  await expect(row()).toContainText("115%");
  await row().click();
  await expect(page).toHaveURL(/\/transactions\?/);
  await expect(page.getByText("3 transactions")).toBeVisible();
});

test("targets can be managed from settings", async ({ page }) => {
  const tagId = await newTag(page, "e2e-managed");
  await page.goto("/settings/tags");
  await page.getByRole("button", { name: /Actions for e2e-managed/i }).click();
  await page.getByRole("menuitem", { name: /Set monthly target/ }).click();
  await page.getByLabel("Monthly limit ($)").fill("250");
  await page.getByRole("button", { name: "Add target" }).click();
  await expect(page.getByText("Target added")).toBeVisible();

  await page.goto("/settings/targets");
  const item = page.getByTestId("target-setting").filter({ hasText: "e2e-managed" });
  await expect(item).toContainText("$250.00");
  await expect(item).toContainText("Every month");

  await item.getByRole("button", { name: /Actions for the e2e-managed target/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Monthly limit ($)").fill("300");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(item).toContainText("$300.00");

  await item.getByRole("button", { name: /Actions for the e2e-managed target/ }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(item).toHaveCount(0);
  void tagId;
});

test("the targets card fits a phone", async ({ page }) => {
  const tagId = await newTag(page, "e2e-narrow-with-a-fairly-long-tag-name");
  await page.request.post("/api/targets", { data: { kind: "tag", subjectId: tagId, amountCents: 123_456_78 } });
  insertExpense(DB, { accountId: "fake-checking", description: "E2E NARROW", dollars: 99999, tagIds: [tagId] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByTestId("target-row").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto("/settings/targets");
  await expect(page.getByTestId("target-setting").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
