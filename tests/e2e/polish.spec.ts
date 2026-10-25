import { expect, test, type Page } from "@playwright/test";
import { revealLazy } from "./helpers";

// Shares the "targets" project's seeded server (desktop viewport).
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("privacy mode blurs every amount and is remembered", async ({ page }) => {
  await login(page);
  const money = page.locator("[data-money]").first();
  await expect(money).toBeVisible();
  expect(await money.evaluate((el) => getComputedStyle(el).filter)).toBe("none");

  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(page.getByRole("button", { name: "Show amounts" })).toHaveAttribute("aria-pressed", "true");
  expect(await money.evaluate((el) => getComputedStyle(el).filter)).toContain("blur");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-privacy", "on"); // set before first paint
  expect(
    await page
      .locator("[data-money]")
      .first()
      .evaluate((el) => getComputedStyle(el).filter),
  ).toContain("blur");

  await page.getByRole("button", { name: "Show amounts" }).click();
  expect(
    await page
      .locator("[data-money]")
      .first()
      .evaluate((el) => getComputedStyle(el).filter),
  ).toBe("none");
  await expect(page.locator("html")).not.toHaveAttribute("data-privacy", "on");
});

test("keyboard shortcuts: go-to sequences, search, register navigation and help", async ({ page }) => {
  await login(page);
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByTestId("txn-row").first()).toBeVisible();

  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search transactions" })).toBeFocused();
  await page.keyboard.type("jk"); // typing in the field never triggers shortcuts
  await expect(page).toHaveURL(/\/transactions/);
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("");
  await page.locator("body").click({ position: { x: 5, y: 300 } });

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  const rows = page.getByTestId("txn-row");
  await expect(page.locator("[data-active]")).toHaveCount(1);
  expect(await rows.nth(0).getAttribute("data-active")).not.toBeNull(); // the first j lands on row 1, j moves to row 2, k back to row 1
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("c");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 300 } }); // the closed picker keeps focus (and its type-ahead) until you leave it

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/spending/);
  await page.keyboard.press("/"); // no search box here: goes to the register's
  await expect(page).toHaveURL(/\/transactions#search/);
  await expect(page.getByRole("searchbox", { name: "Search transactions" })).toBeFocused();
});

test("every main chart can be read as a table", async ({ page }) => {
  await login(page);
  await revealLazy(page);
  const nw = page.locator('[aria-labelledby="net-worth-title"]');
  await nw.getByRole("button", { name: "View as table" }).click();
  const table = nw.getByRole("region", { name: "Net worth by day (table)" });
  await expect(table.getByRole("columnheader", { name: "Date" })).toBeVisible();
  expect(await table.getByRole("row").count()).toBeGreaterThan(10);
  await nw.getByRole("button", { name: "View as chart" }).click();
  await expect(nw.getByTestId("balance-chart")).toBeVisible();

  const pace = page.locator('[aria-labelledby="pace-title"]');
  await pace.getByRole("button", { name: "View as table" }).click();
  await expect(pace.getByTestId("chart-table")).toContainText("3-month average");

  await page.goto("/spending");
  await revealLazy(page);
  await expect(page.getByTestId("trends-chart")).toBeVisible();
  await page.locator("#trends").getByRole("button", { name: "View as table" }).click();
  await expect(page.locator("#trends").getByTestId("chart-table")).toContainText("Income");
  await page.locator("#weekdays").getByRole("button", { name: "View as table" }).click();
  await expect(page.locator("#weekdays").getByTestId("chart-table")).toContainText("Mondays");
});

test("installable: manifest, icons and the service worker are served without a session", async ({ request, page }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", name: "SimpleBudget" });
  const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("/_next/static/");
  await login(page);
  await expect
    .poll(async () =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? "none"),
    )
    .toBe("activated");
});

test("hardening: security headers, cross-site POSTs refused, backups from About", async ({ page, request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");

  const evil = await request.post("/api/auth/login", {
    headers: { origin: "https://evil.example" },
    data: { password: "password1234" },
  });
  expect(evil.status()).toBe(403);
  const sameSite = await request.post("/api/auth/login", {
    headers: { "sec-fetch-site": "cross-site" },
    data: { password: "x" },
  });
  expect(sameSite.status()).toBe(403);

  await login(page);
  await page.goto("/settings/about");
  await expect(page.getByText("Database size")).toBeVisible();
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("Backup written")).toBeVisible();
  await expect(page.getByTestId("backup-list").getByRole("listitem").first()).toContainText(
    /simplebudget-\d{8}-\d{6}\.sqlite/,
  );
});
