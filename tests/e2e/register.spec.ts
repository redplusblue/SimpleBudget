import { expectNoHorizontalOverflow } from "./helpers";
import { expect, test, type Page } from "@playwright/test";

const CHECKING = "/accounts/ACT-chk-1001";
const row = (page: Page, text: string | RegExp) => page.getByTestId("txn-row").filter({ hasText: text });

/** The list is virtualized, so older rows aren't in the DOM until scrolled to: search narrows it first. */
async function narrow(page: Page, query: string) {
  await page.getByRole("searchbox", { name: "Search transactions" }).fill(query);
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(query)}`));
  await expect(page.getByTestId("txn-row").first()).toBeVisible();
}

// Desktop and mobile share one database and run in parallel, so each project edits different merchants.
const who = (isMobile: boolean) => ({
  recategorize: isMobile ? { query: "landlord", name: "Landlord" } : { query: "trader", name: "Trader Joe's" },
  rollback: { query: "maintenance", name: "MONTHLY MAINTENANCE FEE" }, // never changes: its save is rejected
  drawer: isMobile ? { query: "utilities", name: "CITY UTILITIES BILL PAY" } : { query: "payroll", name: "ACME Corp" },
});

test.describe("accounts overview", () => {
  test("groups accounts with totals and links to each account", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Cash", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Credit", exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /Total Checking/ })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: /Sapphire Credit Card/ })).toContainText(
      "-$1,234.56",
    );
    await expectNoHorizontalOverflow(page);
    await page
      .getByRole("link", { name: /High Yield Savings/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/accounts\/ACT-sav-3003$/);
    await expect(page.getByRole("heading", { name: "High Yield Savings" })).toBeVisible();
  });
});

test.describe("account page and register", () => {
  test("shows balance, chart, month stats and transactions without horizontal overflow", async ({ page }) => {
    await page.goto(CHECKING);
    await expect(page.getByRole("heading", { name: "Total Checking" })).toBeVisible();
    await expect(page.getByText("$4,823.17").first()).toBeVisible();
    await expect(page.getByText("Balance, last 90 days")).toBeVisible();
    await expect(page.getByText("Money in")).toBeVisible();
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("unknown accounts show a friendly message", async ({ page }) => {
    await page.goto("/accounts/nope");
    await expect(page.getByText(/couldn't find that account/i)).toBeVisible();
  });

  test("running balance matches the bank balance on the newest posted row (API)", async ({ request }) => {
    const res = await (await request.get("/api/transactions?account=ACT-chk-1001")).json();
    const posted = res.rows.filter((r: { pending: boolean }) => !r.pending);
    const pending = res.rows.filter((r: { pending: boolean }) => r.pending);
    expect(posted[0].runningBalanceCents).toBe(482317);
    expect(pending.every((r: { runningBalanceCents: number | null }) => r.runningBalanceCents === null)).toBe(true);
    // each row's balance steps back by the newer row's amount
    for (let i = 1; i < posted.length; i++) {
      expect(posted[i].runningBalanceCents).toBe(posted[i - 1].runningBalanceCents - posted[i - 1].amountCents);
    }
  });

  test("search narrows the list and is reflected in the URL", async ({ page }) => {
    await page.goto(CHECKING);
    await expect(page.getByTestId("txn-row")).not.toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search transactions" }).fill("payroll");
    await expect(page).toHaveURL(/q=payroll/);
    await expect(page.getByText("4 transactions")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search transactions" }).fill("zzzz-nothing");
    await expect(page.getByText("No transactions match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByTestId("txn-row").first()).toBeVisible();
  });

  test("changing a category is instant and persists", async ({ page, isMobile }) => {
    const { query, name } = who(isMobile).recategorize;
    await page.goto(CHECKING);
    await narrow(page, query);
    const combo = row(page, name)
      .first()
      .getByRole("combobox", { name: /Category for/ });
    await expect(combo).toHaveText(/Uncategorized/);
    await combo.click();
    await page.getByRole("option", { name: "Groceries" }).click();
    await expect(combo).toHaveText(/Groceries/);
    await page.reload();
    await expect(
      row(page, name)
        .first()
        .getByRole("combobox", { name: /Category for/ }),
    ).toHaveText(/Groceries/);
  });

  test("a failed save rolls back and shows a toast", async ({ page, isMobile }) => {
    const { query, name } = who(isMobile).rollback;
    await page.route("**/api/transactions/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) })
        : route.continue(),
    );
    await page.goto(CHECKING);
    await narrow(page, query);
    const combo = row(page, name)
      .first()
      .getByRole("combobox", { name: /Category for/ });
    await combo.click();
    await page.getByRole("option", { name: "Fees" }).click();
    await expect(page.getByText("Couldn't save that change")).toBeVisible();
    await expect(combo).toHaveText(/Uncategorized/);
  });

  test("detail drawer: bank data is read-only, edits persist, tags can be created", async ({ page, isMobile }) => {
    const { query, name } = who(isMobile).drawer;
    await page.goto(CHECKING);
    await narrow(page, query);
    await row(page, name)
      .first()
      .getByRole("button", { name: /Open details/ })
      .click();
    const dialog = page.locator('[data-slot="sheet-content"]');
    await expect(dialog.getByText("From your bank")).toBeVisible();
    await expect(dialog.getByText("Imported data is read-only")).toBeVisible();

    const note = `note-${isMobile ? "m" : "d"}`;
    await dialog.getByLabel("Notes").fill(note);
    await dialog.getByLabel("Notes").blur();

    const tag = `tag-${isMobile ? "m" : "d"}`;
    await dialog.getByRole("button", { name: "Add tag" }).click();
    await page.getByPlaceholder("Find or create a tag…").fill(tag);
    await page.getByRole("option", { name: new RegExp(`Create .${tag}.`) }).click();
    await expect(dialog.getByRole("region", { name: "Your edits" }).getByText(tag, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); // closes the tag popover
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page, name).first()).toContainText(tag);

    await page.reload();
    await row(page, name)
      .first()
      .getByRole("button", { name: /Open details/ })
      .click();
    await expect(page.locator('[data-slot="sheet-content"]').getByLabel("Notes")).toHaveValue(note);
    await page.locator('[data-slot="sheet-content"]').getByRole("button", { name: "Show raw data" }).click();
    await expect(page.locator('[data-slot="sheet-content"]').locator("pre")).toContainText('"amount"');
  });

  test("bulk edit applies a category to every selected row", async ({ page, isMobile }) => {
    await page.goto(CHECKING);
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    // Desktop edits the payroll deposits, mobile the second rent payment (the first is used by another test).
    const target = isMobile ? "Landlord" : "ACME Corp";
    await narrow(page, isMobile ? "landlord" : "payroll");
    if (isMobile) {
      await row(page, target)
        .nth(1)
        .dispatchEvent("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true });
      await page.waitForTimeout(700); // long-press
      await expect(bar).toContainText("1 selected");
    } else {
      await page.getByRole("checkbox", { name: "Select ACME Corp" }).nth(0).check();
      await page.getByRole("checkbox", { name: "Select ACME Corp" }).nth(1).check();
      await expect(bar).toContainText("2 selected");
    }
    await bar.getByRole("combobox", { name: "Set category for selected" }).click();
    await page.getByRole("option", { name: isMobile ? "Rent/Mortgage" : "Income" }).click();
    await expect(bar).toBeHidden(); // selection clears after applying
    const expected = isMobile ? /Rent\/Mortgage/ : /Income/;
    const indexes = isMobile ? [1] : [0, 1];
    for (const i of indexes)
      await expect(
        row(page, target)
          .nth(i)
          .getByRole("combobox", { name: /Category for/ }),
      ).toHaveText(expected);
  });
});

test.describe("all transactions", () => {
  test("shows every account with totals, transfers filter via URL, and date presets", async ({ page }) => {
    await page.goto("/transactions");
    await expect(page.getByText("22 transactions")).toBeVisible();
    await expect(page.getByTestId("txn-row").first()).toBeVisible();

    await page.goto("/transactions?type=transfer");
    await expect(page.getByTestId("txn-row")).toHaveCount(4);
    for (const r of await page.getByTestId("txn-row").all()) await expect(r).toContainText("Transfer");
  });

  test("date presets narrow the list", async ({ page, isMobile }) => {
    await page.goto("/transactions");
    await expect(page.getByText("22 transactions")).toBeVisible();
    if (isMobile) {
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("dialog").getByRole("combobox", { name: "Date range" }).click();
    } else {
      await page.getByRole("combobox", { name: "Date range" }).click();
    }
    await page.getByRole("option", { name: "Last 30 days" }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
    if (isMobile) await page.getByRole("button", { name: "Done" }).click();
    const label = page.getByText(/^\d+ transactions?$/);
    await expect(label).toBeVisible();
    const n = Number((await label.textContent())!.split(" ")[0]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(22);
  });

  test("mobile filters drawer applies and clears filters", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the drawer is mobile-only");
    await page.goto("/transactions");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "Expenses" }).click();
    await expect(page).toHaveURL(/type=expense/);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
    await expect(page.getByTestId("txn-row").filter({ hasText: "ACME" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/type=/);
  });

  test("sidebar lists accounts on desktop", async ({ page, isMobile }) => {
    test.skip(isMobile, "the sidebar is desktop-only");
    await page.goto("/");
    const nav = page.getByRole("group", { name: "Your accounts" });
    await expect(nav.getByRole("link", { name: /Total Checking/ })).toBeVisible();
    await nav.getByRole("link", { name: /Sapphire Credit Card/ }).click();
    await expect(page).toHaveURL(/ACT-cc-2002/);
    await expect(nav.getByRole("link", { name: /Sapphire Credit Card/ })).toHaveAttribute("aria-current", "page");
  });
});

test("account settings: exclude from net worth, then restore", async ({ page, isMobile }) => {
  test.skip(isMobile, "one project edits the shared account");
  await page.goto("/accounts/ACT-sav-3003");
  await page.getByRole("button", { name: "Account settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("switch", { name: /Exclude from net worth/ }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Not in net worth")).toBeVisible();
  try {
    await page.reload();
    await expect(page.getByText("Not in net worth")).toBeVisible();
  } finally {
    await page.getByRole("button", { name: "Account settings" }).click();
    await page
      .getByRole("dialog")
      .getByRole("switch", { name: /Exclude from net worth/ })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Not in net worth")).toBeHidden();
  }
});
