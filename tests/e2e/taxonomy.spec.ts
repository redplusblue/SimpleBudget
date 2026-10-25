import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Desktop and mobile share one database and run in parallel, so every name is unique per project.
const tag = (isMobile: boolean) => (isMobile ? "m" : "d");
const SAVINGS = "ACT-sav-3003";

async function createCategory(request: APIRequestContext, name: string) {
  const res = await request.post("/api/categories", { data: { name, color: "#6366F1", icon: "tag" } });
  expect(res.status()).toBe(201);
  return (await res.json()).category as { id: number };
}
const deleteCategory = (request: APIRequestContext, id: number) => request.delete(`/api/categories/${id}`);
const categoryRow = (page: Page, name: string) => page.getByTestId("category-row").filter({ hasText: name });
const openMenu = async (page: Page, name: string) => page.getByRole("button", { name: `Actions for ${name}` }).click();

async function interestTxnIds(request: APIRequestContext): Promise<number[]> {
  const page = await (await request.get(`/api/transactions?account=${SAVINGS}&q=interest`)).json();
  return page.rows.map((r: { id: number }) => r.id);
}

test.describe("categories", () => {
  test("add, edit, archive, restore and delete a category", async ({ page, isMobile }) => {
    const name = `Pets-${tag(isMobile)}`;
    await page.goto("/settings/categories");
    await page.getByRole("button", { name: "Add category" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Group (optional)").fill("Home");
    await dialog.getByRole("radio", { name: "#10B981" }).click();
    await dialog.getByRole("radio", { name: "paw print" }).click();
    await dialog.getByRole("button", { name: "Add category" }).click();
    await expect(categoryRow(page, name)).toContainText("Home · 0 transactions");

    // a duplicate name is refused with a clear message
    await page.getByRole("button", { name: "Add category" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(name.toUpperCase());
    await page.getByRole("dialog").getByRole("button", { name: "Add category" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("already exists");
    await page.keyboard.press("Escape");

    await openMenu(page, name);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const renamed = `${name}-renamed`;
    await page.getByRole("dialog").getByLabel("Name").fill(renamed);
    await page
      .getByRole("dialog")
      .getByRole("switch", { name: /Income category/ })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(categoryRow(page, renamed)).toContainText("Income");

    await openMenu(page, renamed);
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(categoryRow(page, renamed)).toContainText("Archived");
    await openMenu(page, renamed);
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await expect(categoryRow(page, renamed)).not.toContainText("Archived");

    await openMenu(page, renamed);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(categoryRow(page, renamed)).toHaveCount(0);
  });

  test("merging moves every transaction into the other category", async ({ page, request, isMobile }) => {
    const [from, into] = [
      await createCategory(request, `Merge-from-${tag(isMobile)}`),
      await createCategory(request, `Merge-into-${tag(isMobile)}`),
    ];
    const ids = await interestTxnIds(request);
    const txn = ids[isMobile ? 1 : 0];
    try {
      expect((await request.patch(`/api/transactions/${txn}`, { data: { categoryId: from.id } })).ok()).toBe(true);
      await page.goto("/settings/categories");
      await expect(categoryRow(page, `Merge-from-${tag(isMobile)}`)).toContainText("1 transaction");

      await openMenu(page, `Merge-from-${tag(isMobile)}`);
      await page.getByRole("menuitem", { name: /Merge into/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("combobox", { name: "Merge into" }).click();
      await page.getByRole("option", { name: `Merge-into-${tag(isMobile)}` }).click();
      await expect(dialog).toContainText("1 transaction will move");
      await dialog.getByRole("button", { name: "Merge" }).click();

      await expect(categoryRow(page, `Merge-from-${tag(isMobile)}`)).toHaveCount(0);
      await expect(categoryRow(page, `Merge-into-${tag(isMobile)}`)).toContainText("1 transaction");
      const detail = await (await request.get(`/api/transactions/${txn}`)).json();
      expect(detail.transaction.categoryId).toBe(into.id);
    } finally {
      await request.patch(`/api/transactions/${txn}`, { data: { categoryId: null } });
      await deleteCategory(request, from.id);
      await deleteCategory(request, into.id);
    }
  });

  test("reordering with the move buttons persists", async ({ page, request, isMobile }) => {
    // A reorder sends the whole list, so two projects reordering at once could overwrite each other. Mobile only:
    // there the move buttons are the way to reorder (drag and drop is desktop-only and covered by unit tests).
    test.skip(!isMobile, "one project reorders the shared lists");
    const names = ["A", "B"].map((x) => `Order-${x}-${tag(isMobile)}`);
    const cats = [await createCategory(request, names[0]), await createCategory(request, names[1])];
    try {
      await page.goto("/settings/categories");
      await expect(categoryRow(page, names[1])).toBeVisible(); // wait for the list to load before reading its order
      const order = async () =>
        (await page.getByTestId("category-row").allTextContents())
          .map((t) => names.findIndex((n) => t.includes(n)))
          .filter((i) => i >= 0);
      expect(await order()).toEqual([0, 1]);
      // The list updates optimistically, so wait for the save itself before reloading to check it stuck.
      const saved = page.waitForResponse(
        (r) => r.url().includes("/api/categories/order") && r.request().method() === "PUT",
      );
      await page.getByRole("button", { name: `Move ${names[1]} up` }).click();
      expect((await saved).ok()).toBe(true);
      await expect.poll(order).toEqual([1, 0]);
      await page.reload();
      await expect(categoryRow(page, names[1])).toBeVisible();
      expect(await order()).toEqual([1, 0]);
    } finally {
      for (const c of cats) await deleteCategory(request, c.id);
    }
  });

  test("an archived category is hidden from pickers but rows keep showing its name", async ({
    page,
    request,
    isMobile,
  }) => {
    const name = `Archived-${tag(isMobile)}`;
    const cat = await createCategory(request, name);
    const txn = (await interestTxnIds(request))[isMobile ? 0 : 1];
    try {
      await request.patch(`/api/transactions/${txn}`, { data: { categoryId: cat.id } });
      await request.patch(`/api/categories/${cat.id}`, { data: { isArchived: true } });
      await page.goto(`/accounts/${SAVINGS}`);
      const row = page
        .getByTestId("txn-row")
        .filter({ hasText: "INTEREST PAID" })
        .nth(isMobile ? 0 : 1);
      await expect(row.getByRole("combobox", { name: /Category for/ })).toContainText(name);
      await row.getByRole("combobox", { name: /Category for/ }).click();
      await expect(page.getByRole("option", { name: new RegExp(`^${name}`) })).toHaveCount(1); // the current value only
      await expect(page.getByRole("option", { name: "Groceries" })).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await request.patch(`/api/transactions/${txn}`, { data: { categoryId: null } });
      await deleteCategory(request, cat.id);
    }
  });
});

test.describe("tags", () => {
  test("add, rename, recolor and delete a tag", async ({ page, isMobile }) => {
    const name = `trip-${tag(isMobile)}`;
    await page.goto("/settings/tags");
    await page.getByLabel("New tag name").fill(name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const row = page.getByTestId("tag-row").filter({ hasText: name });
    await expect(row).toContainText("0 transactions");

    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill(`${name}-2`);
    await page.getByRole("dialog").getByRole("radio", { name: "#F59E0B" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    const renamed = page.getByTestId("tag-row").filter({ hasText: `${name}-2` });
    await expect(renamed).toBeVisible();

    await page.getByRole("button", { name: `Actions for ${name}-2` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(renamed).toHaveCount(0);
  });
});
