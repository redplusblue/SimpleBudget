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

test.describe("spending analytics on 10,000 transactions", () => {
  test("the report builds quickly and its sections agree with each other", async ({ page }) => {
    const request = page.request;
    const res = await request.get("/api/spending?from=2025-10-25&to=2026-10-24");
    const dur = Number(/spending;dur=([\d.]+)/.exec(res.headers()["server-timing"] ?? "")?.[1]);
    expect(dur).toBeGreaterThan(0);
    expect(dur).toBeLessThan(300);
    const r = await res.json();
    const sum = (rows: Array<{ cents: number }>) => rows.reduce((s, x) => s + x.cents, 0);
    expect(r.summary.spentCents).toBeGreaterThan(0);
    expect(sum(r.categories)).toBe(r.summary.spentCents);
    expect(sum(r.accounts)).toBe(r.summary.spentCents);
    expect(sum(r.daily)).toBe(r.summary.spentCents);
    expect(r.merchants).toHaveLength(15);
  });

  test("recurring charges: landlord, Netflix and Spotify are found; coffee and utilities are not", async ({
    request,
    page,
  }) => {
    await page.goto("/");
    const r = await (await page.request.get("/api/recurring")).json();
    const names = r.items.map((i: { name: string }) => i.name);
    expect(names).toEqual(expect.arrayContaining(["ZELLE TO LANDLORD JANE", "NETFLIX.COM", "SPOTIFY USA"]));
    for (const bad of [
      "BLUE BOTTLE COFFEE",
      "CITY UTILITIES BILL PAY",
      "AMAZON MKTPLACE PMTS",
      "CHASE CREDIT CRD AUTOPAY",
    ])
      expect(names).not.toContain(bad);
    expect(r.items.every((i: { cadence: string }) => i.cadence === "monthly")).toBe(true);
    expect(r.monthlyTotalCents).toBeGreaterThan(185_000 + 1_549 + 1_199 - 1);
    void request;
  });

  test("the dashboard's Upcoming card lists the next recurring charges", async ({ page }) => {
    await page.goto("/");
    const list = page.getByTestId("upcoming-list");
    await expect(list).toBeVisible();
    await expect(list.getByRole("listitem").first()).toContainText(/\d+ days?|today|tomorrow|late/);
    await expect(page.getByText(/a month across \d+ recurring charges?/)).toBeVisible();
  });

  test("category, merchant and calendar drill-downs land on a register with the same count", async ({ page }) => {
    const qs = "from=2026-09-01&to=2026-09-30";
    const r = await (await page.request.get(`/api/spending?${qs}`)).json();
    const registerTotal = async () =>
      Number((await page.getByText(/^[\d,]+ transactions?$/).textContent())!.replace(/\D/g, ""));

    // a category row
    const cat = r.categories.find((c: { id: number | null }) => c.id !== null);
    await page.goto(`/spending?${qs}`);
    await page
      .getByTestId("category-table")
      .getByRole("link", { name: new RegExp(cat.name) })
      .first()
      .click();
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
    expect(await registerTotal()).toBe(cat.count);

    // a merchant row
    const merchant = r.merchants[1];
    await page.goto(`/spending?${qs}`);
    await page
      .getByTestId("merchant-table")
      .getByRole("link", { name: new RegExp(merchant.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
      .first()
      .click();
    await expect(page.getByTestId("merchant-chip")).toBeVisible();
    expect(await registerTotal()).toBe(merchant.count);

    // a calendar day (September 2026 is a full month of data)
    const busy = [...r.daily].sort((a: { cents: number }, b: { cents: number }) => b.cents - a.cents)[0];
    await page.goto(`/spending?month=2026-09`);
    await page
      .getByTestId("heatmap")
      .getByRole("link", {
        name: new RegExp(
          `${new Date(`${busy.date}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}:`,
        ),
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`from=${busy.date}`));
    const dayCount = (
      await (await page.request.get(`/api/transactions?from=${busy.date}&to=${busy.date}&type=expense`)).json()
    ).total;
    expect(await registerTotal()).toBe(dayCount);
  });

  test("the trend chart and weekday chart render, and the page renders in well under 6 seconds", async ({ page }) => {
    const t0 = Date.now();
    await page.goto("/spending");
    await expect(page.getByTestId("trends-chart")).toBeVisible();
    await expect(page.getByTestId("weekday-chart")).toBeVisible();
    await expect(page.getByTestId("recurring-total")).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(6000);
  });
});
