import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, insertExpense, revealLazy } from "./helpers";

// Shares the "targets" project's seeded server (it adds a couple of transactions with unique merchants).
const DB = "./data/e2e-targets.db";

test.beforeEach(async ({ page }: { page: Page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("insights are computed without any AI configuration, in under 300 ms", async ({ page }) => {
  // Best of three: the server shares the machine with other test servers, and the header measures compute only.
  const durations: number[] = [];
  let body: { insights: unknown[] } | undefined;
  for (let i = 0; i < 3; i++) {
    const res = await page.request.get("/api/insights");
    expect(res.ok()).toBeTruthy();
    const timing = /insights;dur=([\d.]+)/.exec(res.headers()["server-timing"] ?? "");
    durations.push(Number(timing?.[1] ?? Infinity));
    body = await res.json();
  }
  expect(Math.min(...durations)).toBeLessThan(300);
  expect(Array.isArray(body?.insights)).toBe(true);
});

test("a duplicate-looking charge shows up on the Insights page and the dashboard", async ({ page }) => {
  insertExpense(DB, { accountId: "fake-checking", description: "E2E DUPE DINER", dollars: 23.45, secondsAgo: 3600 });
  insertExpense(DB, { accountId: "fake-checking", description: "E2E DUPE DINER", dollars: 23.45, secondsAgo: 1800 });

  await page.goto("/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  const card = page.getByTestId("insight").filter({ hasText: "Possible duplicate charge at E2E DUPE DINER" });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-severity", "warn");
  await expect(card).toContainText("Needs attention");
  await expect(card).toContainText("$23.45");

  await card.getByRole("link", { name: /View transactions/ }).click();
  await expect(page).toHaveURL(/merchant=/);
  await expect(page.getByText("2 transactions")).toBeVisible();

  // The dashboard teaser shows the top three (warnings first) and links to the rest.
  await page.goto("/");
  await revealLazy(page);
  const teaser = page.getByRole("region", { name: "Insights" }).or(page.locator('[aria-labelledby="insights-title"]'));
  await expect(teaser.getByTestId("insight").first()).toBeVisible();
  expect(await teaser.getByTestId("insight").count()).toBeLessThanOrEqual(3);
  await teaser.getByRole("link", { name: /See all|Details/ }).click();
  await expect(page).toHaveURL(/\/insights$/);
});

test("the Insights page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/insights");
  await expect(page.getByTestId("insights-list")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByTestId("insights-teaser").or(page.getByText("Nothing notable right now."))).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
