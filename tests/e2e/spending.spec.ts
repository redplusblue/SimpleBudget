import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

// The fixture data sits within the last ~45 days, so a 90-day window ending tomorrow always contains all of it.
// Totals (dollars): spent 3,570.86 over 12 purchases (transfers and the pending items are counted correctly),
// income 9,808.09 (four paychecks plus two interest payments).
const pad = (n: number) => String(n).padStart(2, "0");
// Local dates, like the page's own presets.
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (offset: number) => iso(new Date(Date.now() + offset * 86_400_000));
const WINDOW = `from=${day(-90)}&to=${day(1)}`;

test.describe("spending API", () => {
  test("totals match the hand-computed fixture numbers", async ({ request }) => {
    const r = await (await request.get(`/api/spending?${WINDOW}`)).json();
    expect(r.range).toMatchObject({ kind: "custom", days: 92 });
    expect(r.summary).toMatchObject({
      spentCents: 357_086,
      purchaseCount: 12,
      incomeCents: 980_809,
      netCents: 980_809 - 357_086,
    });
    expect(r.summary.savingsRate).toBeCloseTo((980_809 - 357_086) / 980_809);
    expect(r.summary.largest).toMatchObject({ amountCents: 150_000 });
    // every breakdown adds up to the same total
    const sum = (rows: Array<{ cents: number }>) => rows.reduce((s, x) => s + x.cents, 0);
    expect(sum(r.categories)).toBe(357_086);
    expect(sum(r.accounts)).toBe(357_086);
    expect(sum(r.daily)).toBe(357_086);
    expect(sum(r.weekdays)).toBe(357_086);
    expect(r.merchants[0]).toMatchObject({
      name: "Landlord",
      key: "landlord",
      cents: 300_000,
      count: 2,
      avgCents: 150_000,
    });
    expect(r.accounts.map((a: { id: string }) => a.id).sort()).toEqual(["ACT-cc-2002", "ACT-chk-1001"]);
  });

  test("defaults to the current month and reports Server-Timing", async ({ request }) => {
    const res = await request.get("/api/spending");
    const r = await res.json();
    expect(r.range).toMatchObject({ kind: "month", isCurrent: true });
    expect(r.range.month).toMatch(/^\d{4}-\d{2}$/);
    expect(res.headers()["server-timing"]).toMatch(/spending;dur=/);
  });

  test("rejects bad ranges", async ({ request }) => {
    for (const qs of [
      "month=2026-13",
      "month=nope",
      "from=2026-10-10&to=2026-10-01",
      "from=2026-10-10",
      "to=2026-10-10",
      "from=2026-02-30&to=2026-03-01",
      "from=2024-01-01&to=2026-01-01",
    ]) {
      const res = await request.get(`/api/spending?${qs}`);
      expect(res.status(), qs).toBe(400);
      expect((await res.json()).message).toBeTruthy();
    }
  });

  test("recurring: the fixture has too few repeats to detect anything", async ({ request }) => {
    expect(await (await request.get("/api/recurring")).json()).toEqual({
      items: [],
      inactive: [],
      monthlyTotalCents: 0,
      yearlyTotalCents: 0,
    });
  });
});

test.describe("spending page", () => {
  test("summary tiles show the totals and link to the right transactions", async ({ page }) => {
    await page.goto(`/spending?${WINDOW}`);
    await expect(page.getByTestId("tile-spent")).toContainText("$3,570.86");
    await expect(page.getByTestId("tile-income")).toContainText("$9,808.09");
    await expect(page.getByTestId("tile-count")).toContainText("12");
    await expect(page.getByTestId("tile-savings")).toContainText("64%");
    await expect(page.getByTestId("tile-largest")).toContainText("$1,500.00");
    await expect(page.getByTestId("range-summary")).toContainText("compared with");

    await page.getByTestId("tile-spent").getByRole("link").click();
    await expect(page).toHaveURL(/\/transactions\?/);
    await expect(page).toHaveURL(/type=expense/);
    await expect(page).toHaveURL(/from=/);
    await expect(page.getByText("12 transactions")).toBeVisible();
  });

  test("a merchant row opens the register on exactly that merchant", async ({ page }) => {
    await page.goto(`/spending?${WINDOW}`);
    await page
      .getByTestId("merchant-table")
      .getByRole("link", { name: /Landlord/ })
      .click();
    await expect(page).toHaveURL(/merchant=landlord/);
    await expect(page.getByTestId("merchant-chip")).toContainText("Landlord");
    await expect(page.getByText("2 transactions")).toBeVisible();
    // the chip can be removed, widening the list again
    await page.getByRole("button", { name: "Remove merchant filter" }).click();
    await expect(page).not.toHaveURL(/merchant=/);
    await expect(page.getByText("12 transactions")).toBeVisible();
  });

  test("account rows and the weekday, calendar and trend sections render", async ({ page }) => {
    await page.goto(`/spending?${WINDOW}`);
    await expect(page.getByTestId("account-list")).toContainText("Total Checking");
    await expect(page.getByTestId("account-list")).toContainText("Sapphire Credit Card");
    await expect(page.getByTestId("weekday-chart")).toBeVisible();
    await expect(page.getByTestId("trends-chart")).toBeVisible();
    await expect(page.getByTestId("heatmap")).toBeVisible();
    await expect(page.getByText("No recurring charges detected yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "By tag" })).toBeVisible();

    await page
      .getByTestId("account-list")
      .getByRole("link", { name: /Sapphire Credit Card/ })
      .click();
    await expect(page).toHaveURL(/account=ACT-cc-2002/);
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
  });

  test("a calendar day opens that day's purchases", async ({ page, request }) => {
    const r = await (await request.get(`/api/spending?${WINDOW}`)).json();
    const spendDay = r.daily.find((d: { cents: number }) => d.cents > 0);
    await page.goto(`/spending?${WINDOW}`);
    await page
      .getByTestId("heatmap")
      .getByRole("link", { name: new RegExp("spent") })
      .first()
      .waitFor();
    // the heatmap shows one month at a time: open the month containing the first day with spending via the range
    await page.goto(`/spending?from=${spendDay.date}&to=${spendDay.date}`);
    await page.getByTestId("heatmap").getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`from=${spendDay.date}`));
    await expect(page).toHaveURL(new RegExp(`to=${spendDay.date}`));
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
  });

  test("the category chart toggles between donut and treemap", async ({ page }) => {
    await page.goto(`/spending?${WINDOW}`);
    await expect(page.getByTestId("category-donut")).toBeVisible();
    await page.getByRole("radio", { name: "Treemap" }).click();
    await expect(page.getByTestId("category-treemap")).toBeVisible();
    await expect(page.getByTestId("category-table")).toBeVisible();
    await page.getByRole("radio", { name: "Donut chart" }).click();
    await expect(page.getByTestId("category-donut")).toBeVisible();
  });

  test("the month picker moves between months and keeps the address in sync", async ({ page }) => {
    await page.goto("/spending?month=2026-03");
    await expect(page.getByTestId("range-label")).toHaveText("March 2026");
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/month=2026-02/);
    await expect(page.getByTestId("range-label")).toHaveText("February 2026");
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page).toHaveURL(/month=2026-04/);
    await expect(page.getByTestId("tile-spent")).toContainText("$0.00"); // nothing that far back in the fixture
    await expect(page.getByText("No spending in this range.").first()).toBeVisible();
  });

  test("the next-month arrow stops at the current month", async ({ page }) => {
    await page.goto("/spending");
    await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
  });

  test("custom range: switch modes, pick dates, use a preset", async ({ page }) => {
    await page.goto("/spending?month=2026-03");
    await page.getByRole("radio", { name: "Custom" }).click();
    await expect(page.getByLabel("From date")).toBeVisible();
    await expect(page).toHaveURL(/from=2026-03-01/);
    await page.getByRole("button", { name: "Last 90 days" }).click();
    await expect(page.getByTestId("tile-spent")).toContainText("$"); // loads
    await expect(page).toHaveURL(new RegExp(`from=${day(-89)}`));
    await page.getByRole("radio", { name: "Month" }).click();
    await expect(page.getByTestId("range-label")).toBeVisible();
  });

  test("the page fits the screen", async ({ page }) => {
    await page.goto(`/spending?${WINDOW}`);
    await expect(page.getByTestId("trends-chart")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
