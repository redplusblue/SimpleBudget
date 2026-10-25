import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Each project targets its own fixture transactions so parallel runs can't interfere.
const target = (isMobile: boolean) =>
  isMobile
    ? { query: "shell oil", account: "ACT-cc-2002", category: "Transport", match: /SHELL OIL/ }
    : { query: "city utilities", account: "ACT-chk-1001", category: "Bills & Utilities", match: /CITY UTILITIES/ };

// A different merchant for the "create from transaction" test: tests within one project run in parallel.
const fromTarget = (isMobile: boolean) =>
  isMobile
    ? { query: "uber", account: "ACT-cc-2002", category: "Transport" }
    : { query: "amazon", account: "ACT-cc-2002", category: "Shopping" };

const ruleRow = (page: Page, text: string) => page.getByTestId("rule-row").filter({ hasText: text });

/** Removes this test's rules (by name prefix, so parallel tests keep theirs) and resets the transactions it touched. */
async function cleanup(request: APIRequestContext, txnQuery: string, account: string, rulePrefix?: string) {
  if (rulePrefix) {
    const rules = (await (await request.get("/api/rules")).json()).rules as Array<{ id: number; name: string }>;
    for (const r of rules.filter((r) => r.name.startsWith(rulePrefix))) await request.delete(`/api/rules/${r.id}`);
  }
  const rows = (
    await (await request.get(`/api/transactions?account=${account}&q=${encodeURIComponent(txnQuery)}`)).json()
  ).rows;
  for (const row of rows)
    await request.patch(`/api/transactions/${row.id}`, { data: { categoryId: null, tagIds: [], payeeOverride: null } });
}

test("create a rule with a live preview, apply it to existing transactions, and it sticks", async ({
  page,
  request,
  isMobile,
}) => {
  const t = target(isMobile);
  const name = `e2e-${isMobile ? "m" : "d"}-rule`;
  await cleanup(request, t.query, t.account, `e2e-${isMobile ? "m" : "d"}-rule`);
  try {
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "New rule" }).first().click();
    const dialog = page.getByRole("dialog");

    // incomplete rules say what's missing instead of previewing
    await expect(dialog.getByRole("button", { name: "Create rule" })).toBeDisabled();
    await expect(dialog).toContainText("Enter a value");

    await dialog.getByLabel("Name (optional)").fill(name);
    await dialog.getByRole("textbox", { name: "Condition 1 value" }).fill(t.query);
    await dialog.getByRole("combobox", { name: "Set category" }).click();
    await page.getByRole("option", { name: t.category }).click();

    // accurate preview: exactly one fixture transaction matches, and applying would update it
    await expect(dialog.getByTestId("rule-preview-count")).toHaveText("Matches 1 existing transaction");
    await expect(dialog.getByTestId("rule-preview-sample")).toContainText(t.match);
    await expect(dialog).toContainText("would update 1 transaction");

    await dialog.getByRole("button", { name: "Create rule" }).click();
    await expect(ruleRow(page, name)).toContainText(`payee contains “${t.query}”`);
    await expect(ruleRow(page, name)).toContainText(`set category to ${t.category}`);

    // nothing changes until applied
    const before = (
      await (await request.get(`/api/transactions?account=${t.account}&q=${encodeURIComponent(t.query)}`)).json()
    ).rows[0];
    expect(before.categoryId).toBeNull();

    await page.getByRole("button", { name: new RegExp(`Actions for ${name}`) }).click();
    await page.getByRole("menuitem", { name: /Apply to existing/ }).click();
    const apply = page.getByRole("dialog");
    await expect(apply.getByTestId("apply-summary")).toContainText("1 transaction match, and 1 would be updated");
    await apply.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Updated 1 transaction")).toBeVisible();

    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/transactions?account=${t.account}&q=${encodeURIComponent(t.query)}`)).json())
            .rows[0].categoryId,
      )
      .not.toBeNull();

    // applying again has nothing left to do
    await page.getByRole("button", { name: new RegExp(`Actions for ${name}`) }).click();
    await page.getByRole("menuitem", { name: /Apply to existing/ }).click();
    await expect(page.getByTestId("apply-summary")).toContainText("1 transaction match, and 0 would be updated");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Apply" })).toBeDisabled();
    await page.getByRole("button", { name: "Cancel" }).click();

    // disable, then delete
    const toggle = ruleRow(page, name).getByRole("switch");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(ruleRow(page, name).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await page.getByRole("button", { name: new RegExp(`Actions for ${name}`) }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(ruleRow(page, name)).toHaveCount(0);
  } finally {
    await cleanup(request, t.query, t.account, `e2e-${isMobile ? "m" : "d"}-rule`);
  }
});

test("rules can be reordered and the order is saved", async ({ page, request, isMobile }) => {
  // A reorder sends the whole list, so two projects reordering at once could overwrite each other. Mobile only:
  // there the move buttons are the way to reorder (drag and drop is desktop-only and covered by unit tests).
  test.skip(!isMobile, "one project reorders the shared lists");
  const prefix = `e2e-${isMobile ? "m" : "d"}-order`;
  const cats = (await (await request.get("/api/categories")).json()).categories as Array<{ id: number }>;
  const make = async (n: string) =>
    (
      await request.post("/api/rules", {
        data: {
          name: `${prefix}-${n}`,
          conditions: [{ field: "payee", op: "contains", value: `zzz-${n}-${prefix}` }],
          actions: { categoryId: cats[0].id },
        },
      })
    ).json();
  try {
    await make("1");
    await make("2");
    await page.goto("/rules");
    await expect(ruleRow(page, `${prefix}-2`)).toBeVisible(); // wait for the list to load before reading its order
    const order = async () =>
      (await page.getByTestId("rule-row").allTextContents())
        .map((t) => (t.includes(`${prefix}-1`) ? 1 : t.includes(`${prefix}-2`) ? 2 : 0))
        .filter(Boolean);
    expect(await order()).toEqual([1, 2]);
    const saved = page.waitForResponse((r) => r.url().includes("/api/rules/order") && r.request().method() === "PUT");
    await page.getByRole("button", { name: `Move ${prefix}-2 up` }).click();
    expect((await saved).ok()).toBe(true);
    await expect.poll(order).toEqual([2, 1]);
    await page.reload();
    await expect(ruleRow(page, `${prefix}-2`)).toBeVisible();
    expect(await order()).toEqual([2, 1]);
  } finally {
    await cleanup(request, "zzz", "ACT-chk-1001", prefix);
  }
});

test("'Create rule from this transaction' opens the builder prefilled", async ({ page, request, isMobile }) => {
  const t = fromTarget(isMobile);
  await cleanup(request, t.query, t.account);
  const row = (
    await (await request.get(`/api/transactions?account=${t.account}&q=${encodeURIComponent(t.query)}`)).json()
  ).rows[0];
  const cat = (await (await request.get("/api/categories")).json()).categories.find(
    (c: { name: string }) => c.name === t.category,
  );
  try {
    await request.patch(`/api/transactions/${row.id}`, { data: { categoryId: cat.id } });
    await page.goto(`/accounts/${t.account}?q=${encodeURIComponent(t.query)}`);
    await page
      .getByTestId("txn-row")
      .filter({ hasText: new RegExp(t.query, "i") })
      .first()
      .getByRole("button", { name: /Open details/ })
      .click();
    await page
      .locator('[data-slot="sheet-content"]')
      .getByRole("link", { name: /Create rule from this/ })
      .click();

    await expect(page).toHaveURL(/\/rules$/);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: "Condition 1 value" })).toHaveValue(new RegExp(t.query, "i"));
    await expect(dialog.getByRole("combobox", { name: "Set category" })).toContainText(t.category);
    await expect(dialog.getByTestId("rule-preview-count")).toContainText("Matches 1 existing transaction");
    await dialog.getByRole("button", { name: "Cancel" }).click(); // leave without saving
    await expect(dialog).toBeHidden();
  } finally {
    await cleanup(request, t.query, t.account);
  }
});

test("the API refuses malformed rules", async ({ request }) => {
  const bad = [
    { conditions: [], actions: { exclude: true } },
    { conditions: [{ field: "description", op: "regex", value: "(" }], actions: { exclude: true } },
    { conditions: [{ field: "payee", op: "contains", value: "x" }], actions: {} },
    { conditions: [{ field: "payee", op: "contains", value: "x" }], actions: { categoryId: 999999 } },
  ];
  for (const body of bad) expect((await request.post("/api/rules", { data: body })).status()).toBe(400);
  expect((await request.post("/api/rules/preview", { data: { rule: bad[0] } })).status()).toBe(400);
  expect((await request.put("/api/rules/order", { data: { ids: [5, 5] } })).status()).toBe(400); // an id listed twice
  expect((await request.put("/api/rules/order", { data: { ids: [999999] } })).status()).toBe(200); // stale ids are ignored
  expect((await request.delete("/api/rules/999999")).status()).toBe(404);
});
