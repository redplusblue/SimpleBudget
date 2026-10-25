import { expectNoHorizontalOverflow, revealLazy } from "./helpers";
import { expect, test } from "@playwright/test";

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

test("net worth hero, assets vs liabilities and the account list agree with the data", async ({ page }) => {
  await page.goto("/");
  await revealLazy(page);
  // Fixture balances: 4,823.17 + (-1,234.56) + 10,300.00
  const card = page.getByRole("region", { name: "Net worth" }).or(page.locator('[aria-labelledby="net-worth-title"]'));
  await expect(card.getByText("$13,888.61")).toBeVisible(); // waits out the count-up animation
  const split = page.getByTestId("assets-liabilities");
  await expect(split).toContainText("$15,123.17");
  await expect(split).toContainText("$1,234.56");
  await expect(page.getByTestId("account-balances")).toContainText("Total Checking");
  await expect(page.getByTestId("account-balances")).toContainText("-$1,234.56");
  // Only one day of snapshots exists, so there is no honest "30 days ago" to compare with.
  await expect(card.getByText("Not enough history yet")).toBeVisible();
});

test("this month at a glance matches /api/dashboard", async ({ page, request }) => {
  const data = await (await request.get("/api/dashboard")).json();
  await page.goto("/");
  await revealLazy(page);
  const glance = page.locator('[aria-labelledby="glance-title"]');
  await expect(glance).toContainText(money(data.glance.spentCents));
  await expect(glance).toContainText(money(data.glance.incomeCents));
  await expect(glance.getByText(/at a glance/)).toBeVisible();
  // pace is only shown when last month has spending to compare against
  if (data.glance.pace && data.glance.pace.lastMonthToDateCents > 0)
    await expect(page.getByTestId("pace")).toBeVisible();
});

test("spending pace chart, recent transactions and placeholders render", async ({ page, request }) => {
  const data = await (await request.get("/api/dashboard")).json();
  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByText("Spending pace")).toBeVisible();
  if (
    data.spending.points.some((p: { current: number | null }) => (p.current ?? 0) > 0) ||
    data.spending.hasComparison
  ) {
    await expect(page.getByTestId("spending-chart")).toBeVisible();
    // The drawn chart, not just its box (a zero-height container renders nothing).
    await expect(page.getByTestId("spending-chart").locator("svg.recharts-surface").first()).toBeVisible();
  }
  const recent = page.getByTestId("recent-list").getByRole("link");
  await expect(recent).toHaveCount(Math.min(8, data.recent.length));
  await expect(recent.first()).toContainText(data.recent[0].displayPayee);
  await expect(page.getByRole("link", { name: /View all/ })).toHaveAttribute("href", "/transactions");
  await expect(page.getByText("Upcoming")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Insights", level: 2 })).toBeVisible();
});

test("the range toggle loads other ranges and keeps the chart visible", async ({ page }) => {
  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByTestId("balance-chart").or(page.getByText(/Balance history builds up/))).toBeVisible();
  const toggle = page.getByRole("group", { name: "Net worth range" }).or(page.getByLabel("Net worth range"));
  const req = page.waitForRequest((r) => r.url().includes("/api/networth?range=1M"));
  await toggle.getByRole("radio", { name: "1M" }).click();
  await req;
  await expect(toggle.getByRole("radio", { name: "1M" })).toHaveAttribute("aria-checked", "true");
  for (const label of ["6M", "1Y", "All"]) {
    await toggle.getByRole("radio", { name: label }).click();
    await expect(toggle.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
  }
});

test("category rows drill into the register with filters applied", async ({ page, request }) => {
  const data = await (await request.get("/api/dashboard")).json();
  test.skip(data.categories.items.length === 0, "no spending this month in the fixture data");
  await page.goto("/");
  await revealLazy(page);
  const first = data.categories.items[0];
  await page
    .locator('[aria-labelledby="categories-title"]')
    .getByRole("link", { name: new RegExp(first.name) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/transactions\?/);
  await expect(page).toHaveURL(/type=expense/);
  await expect(page).toHaveURL(first.id === null ? /category=none/ : new RegExp(`category=${first.id}`));
  await expect(page.getByTestId("txn-row").first()).toBeVisible();
});

test("the dashboard fits the screen", async ({ page }) => {
  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByTestId("assets-liabilities")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test.describe("API validation", () => {
  test("rejects bad months and ranges", async ({ request }) => {
    expect((await request.get("/api/dashboard?month=2026-13")).status()).toBe(400);
    expect((await request.get("/api/dashboard?month=nope")).status()).toBe(400);
    expect((await request.get("/api/networth?range=2W")).status()).toBe(400);
    const nw = await (await request.get("/api/networth?range=ALL")).json();
    expect(nw).toMatchObject({ totalCents: 1388861, assetsCents: 1512317, liabilitiesCents: 123456, range: "ALL" });
  });
  test("a past month has full totals and no pace", async ({ request }) => {
    const d = await (await request.get("/api/dashboard?month=2020-01")).json();
    expect(d.glance).toMatchObject({ isCurrent: false, spentCents: 0, pace: null });
  });
});
