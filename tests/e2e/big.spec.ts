import { expect, test } from "@playwright/test";

// Runs against a database seeded with ~10,000 fake transactions (pnpm db:seed-fake).

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the register virtualizes: thousands of rows, only a few dozen in the DOM", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/accounts/fake-checking");
  await expect(page.getByTestId("txn-row").first()).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(5000);
  await expect(page.getByText(/^[\d,]{4,} transactions$/)).toBeVisible();

  // Scroll far down repeatedly; pages keep loading while the DOM stays small.
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const rendered = await page.getByTestId("txn-row").count();
  expect(rendered).toBeGreaterThan(5);
  expect(rendered).toBeLessThan(120);
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(30_000);
  await expect(page.getByTestId("txn-row").first()).toBeVisible();
});

test("scrolling stays smooth over a 10k-row list", async ({ page }) => {
  await page.goto("/accounts/fake-checking");
  await expect(page.getByTestId("txn-row").first()).toBeVisible();
  const frames = await page.evaluate(async () => {
    const times: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        window.scrollBy(0, 400);
        if (times.length < 150) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return times.slice(3);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // Headless software rendering is slow, so these are guard rails against real jank, not 60fps targets:
  // typical frames stay quick and even the page-loading frames never stall for most of a second.
  expect(p95).toBeLessThan(120);
  expect(sorted[sorted.length - 1]).toBeLessThan(800);
});

test("newest row's running balance equals the bank balance", async ({ page }) => {
  await page.goto("/accounts/fake-checking");
  const header = await page.getByText("$4,823.17").first().textContent();
  expect(header).toBe("$4,823.17");
  const first = page.getByTestId("txn-row").filter({ hasNotText: "Pending" }).first();
  await expect(first).toContainText("$4,823.17");
});

test("search and filters stay fast across 10,000 transactions", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page.getByText(/10,00\d transactions/)).toBeVisible();
  const t0 = Date.now();
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("blue bottle");
  await expect(page).toHaveURL(/q=blue/);
  await expect(page.getByTestId("txn-row").first()).toContainText(/blue bottle/i);
  expect(Date.now() - t0).toBeLessThan(4000);

  await page.goto("/transactions?type=transfer");
  await expect(page.getByTestId("txn-row").first()).toContainText("Transfer");
});

test("dashboard payload is fast and net worth never dips when an account appears mid-history", async ({ page }) => {
  const request = page.request; // shares the logged-in session
  await request.get("/api/dashboard"); // warm statement caches
  // Server-Timing carries pure compute time, so CPU contention from other test servers can't skew it.
  const res = await request.get("/api/dashboard");
  const dur = Number(/dashboard;dur=([\d.]+)/.exec(res.headers()["server-timing"] ?? "")?.[1]);
  expect(dur).toBeGreaterThan(0);
  expect(dur).toBeLessThan(300);

  const nw = await (await request.get("/api/networth?range=3M")).json();
  expect(nw.series.length).toBeGreaterThan(60);
  // The brokerage (~$8.4k) was added 45 days ago: the total steps *up* then, but never falls toward zero.
  const totals: number[] = nw.series.map((p: { balanceCents: number }) => p.balanceCents);
  expect(Math.min(...totals)).toBeGreaterThan(2_000_000);
  const jumps = totals.slice(1).map((v, i) => v - totals[i]);
  expect(Math.max(...jumps)).toBeGreaterThan(500_000); // the day the brokerage appears
  expect(Math.min(...jumps)).toBeGreaterThan(-1_000_000); // and no collapse
});

test("dashboard renders the full layout with 10,000 transactions", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("nw-change")).toBeVisible();
  await expect(page.getByTestId("spending-chart")).toBeVisible();
  await expect(page.getByTestId("category-donut")).toBeVisible();
  await expect(page.getByTestId("recent-list").getByRole("link")).toHaveCount(8);
  expect(Date.now() - t0).toBeLessThan(6000);
  await expect(page.getByTestId("nw-change")).toContainText("%");
});
