import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, insertForeignAccount, revealLazy } from "./helpers";

// Shares the "targets" project's seeded server.
const DB = "./data/e2e-targets.db";
const NTFY_PORT = 3197;
test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("an investment account lists its holdings with allocation and gains", async ({ page }) => {
  await login(page);
  await page.goto("/accounts/fake-ira");
  const table = page.getByTestId("holdings-table");
  await expect(table).toBeVisible();
  await expect(table).toContainText("VTI");
  await expect(table).toContainText("Vanguard Total Stock Market ETF");
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(page.getByTestId("holdings-gain")).toContainText("%");
  await expect(page.getByRole("img", { name: /Allocation: VTI \d+ percent/ })).toBeVisible();
  // accounts without holdings don't show the card
  await page.goto("/accounts/fake-checking");
  await expect(page.getByTestId("holdings-table")).toHaveCount(0);
});

test("goals: create, see progress, edit and remove", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/goals");
  await page.getByRole("button", { name: "New goal" }).click();
  await page.getByLabel("Name").fill("E2E Rainy day");
  await page.getByRole("combobox", { name: "Account" }).click();
  await page.getByRole("option", { name: /High Yield Savings/ }).click();
  await page.getByLabel("Target ($)").fill("20000");
  await page.getByLabel(/Already there/).fill("1000");
  await page.getByLabel(/Target date/).fill("2030-12-31");
  await page.getByRole("button", { name: "Add goal" }).click();
  const card = page.getByTestId("goal-card").filter({ hasText: "E2E Rainy day" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("of");
  await expect(card).toContainText("by Dec 31, 2030");
  await expect(card).toContainText(/Needs .* a month/);
  await expectNoHorizontalOverflow(page);

  await card.getByRole("button", { name: "Actions for E2E Rainy day" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("E2E Rainy day fund");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("goal-card").filter({ hasText: "E2E Rainy day fund" })).toBeVisible();

  const bad = await page.request.post("/api/goals", {
    data: { name: "x", accountId: "fake-savings", targetCents: 100, startCents: 100 },
  });
  expect(bad.status()).toBe(400);

  await page.getByRole("button", { name: "Actions for E2E Rainy day fund" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByTestId("goal-card").filter({ hasText: "E2E Rainy day" })).toHaveCount(0);
});

test("forecast: projects 30 days, lists bills and income, and can include everyday spending", async ({ page }) => {
  await login(page);
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { level: 1, name: "Forecast" })).toBeVisible();
  await expect(page.getByText("Lowest point")).toBeVisible();
  await expect(page.getByTestId("balance-chart")).toBeVisible();
  const events = page.getByTestId("forecast-events");
  await expect(events).toBeVisible();
  expect(await events.getByRole("listitem").count()).toBeGreaterThan(0);
  const before = await page
    .getByText(/^In 30 days$/)
    .locator("xpath=following-sibling::p[1]")
    .textContent();
  await page.getByLabel(/Include everyday spending/).click();
  await expect(page.getByText(/^In 30 days$/).locator("xpath=following-sibling::p[1]")).not.toHaveText(before ?? "");
  const api = await (await page.request.get("/api/forecast")).json();
  expect(api.days).toHaveLength(31);
  expect(api.events.every((e: { kind: string }) => e.kind === "bill" || e.kind === "income")).toBe(true);
});

test("year in review: totals, highlights and the year picker", async ({ page }) => {
  await login(page);
  await page.goto("/year");
  await expect(page.getByTestId("year-review")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("in review");
  await expect(page.getByTestId("year-highlights")).toContainText("Biggest purchase");
  await expect(page.getByTestId("month-bars").getByRole("listitem").first()).toBeVisible();
  const api = await (await page.request.get("/api/year")).json();
  expect(api.spentCents).toBeGreaterThan(0);
  expect(api.topCategories.length).toBeGreaterThan(0);
  expect(api.availableYears.length).toBeGreaterThan(0);
  expect((await page.request.get("/api/year?year=1800")).status()).toBe(400);
  expect((await page.request.get("/api/year?year=abc")).status()).toBe(400);
  await page.getByRole("button", { name: "View as table" }).click();
  await expect(page.getByTestId("chart-table")).toContainText("January");
});

test("currency: a euro account is converted at the rate you set", async ({ page }) => {
  insertForeignAccount(DB, { id: "e2e-eur", name: "E2E Euro cash", currency: "EUR", balanceCents: 100_000 });
  await login(page);
  const total = async () => (await (await page.request.get("/api/networth?range=1M")).json()).totalCents as number;
  const without = await total();

  await page.goto("/settings/currency");
  const row = page.getByTestId("currency-row").filter({ hasText: "EUR" });
  await expect(row).toContainText("No rate yet");
  await row.getByRole("textbox").fill("2");
  await page.getByRole("button", { name: "Save rates" }).click();
  await expect(page.getByText("Rates saved")).toBeVisible();
  expect(await total()).toBe(without + 100_000); // EUR 1,000 at 2.0 is $2,000, replacing the 1:1 count of $1,000

  await page.goto("/");
  await revealLazy(page);
  await expect(page.getByTestId("fx-note")).toContainText("EUR");

  expect((await page.request.put("/api/settings/currency", { data: { rates: { EUR: -1 } } })).status()).toBe(400);
  await page.request.put("/api/settings/currency", { data: { rates: {} } });
  expect((await page.request.delete("/api/accounts/e2e-eur")).ok()).toBe(true);
});

test.describe("alerts", () => {
  let server: Server;
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(NTFY_PORT, "127.0.0.1", r));
  });
  test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

  test("save a destination, never see it again, and send a test message", async ({ page }) => {
    await login(page);
    await page.goto("/settings/notifications");
    await page.getByLabel("Send alerts").click();
    await page.getByLabel("Topic address").fill(`http://127.0.0.1:${NTFY_PORT}/my-private-e2e-topic`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Alert settings saved")).toBeVisible();
    await expect(page.getByLabel("Topic address")).toHaveAttribute("placeholder", /Saved \(127\.0\.0\.1:3197\)/);

    const cfg = await (await page.request.get("/api/settings/notifications")).json();
    expect(JSON.stringify(cfg)).not.toContain("my-private-e2e-topic");
    expect(cfg.config).toMatchObject({ enabled: true, hasUrl: true, host: "127.0.0.1:3197", details: false });

    await page.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText("Sent. Check your device.")).toBeVisible();
    expect(received).toHaveLength(1);
    expect(received[0].headers.title).toBe("SimpleBudget test");
    expect(received[0].body).toContain("notifications work");

    expect((await page.request.put("/api/settings/notifications", { data: { url: "ftp://nope" } })).status()).toBe(400);
    await page.getByRole("button", { name: /Remove the saved address/ }).click();
    await expect(page.getByLabel("Topic address")).toHaveAttribute("placeholder", /^https?:\/\//);
    expect((await page.request.post("/api/settings/notifications/test")).status()).toBe(409);
  });
});

test("the new pages fit a phone", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/forecast",
    "/year",
    "/goals",
    "/settings/currency",
    "/settings/notifications",
    "/accounts/fake-ira",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await revealLazy(page);
    await expectNoHorizontalOverflow(page);
  }
});
