import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

// Shares the "targets" project's seeded server.
test.describe.configure({ mode: "serial" });

const CSV = [
  "Account,Date,Payee,Notes,Category,Amount,Cleared",
  'E2E Old Bank,2019-03-01,"Landlord, Inc.",March rent,E2E Imported Rent,-1200.00,true',
  "E2E Old Bank,2019-03-05,Employer,,E2E Imported Pay,2500.00,true",
  "E2E Old Bank,not-a-date,Broken,,,-1.00,true",
].join("\n");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

const upload = (page: Page) =>
  page
    .getByLabel("CSV file")
    .setInputFiles({ name: "actual-export.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

test("import an Actual Budget export into a new account, then see a re-import change nothing", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/import");
  await upload(page);
  await expect(page.getByTestId("import-file-info")).toContainText("3 rows found, 1 that can't be read");

  // The Actual layout is recognized without any mapping work.
  await expect(page.getByRole("combobox", { name: "Date", exact: true })).toContainText("Date");
  await expect(page.getByRole("combobox", { name: "Amount (one signed column)" })).toContainText("Amount");
  await expect(page.getByRole("combobox", { name: "Category" })).toContainText("Category");
  await expect(page.getByTestId("import-account-row")).toContainText("E2E Old Bank");
  await expect(page.getByRole("combobox", { name: "Destination for E2E Old Bank" })).toContainText(
    "Create a new manual account",
  );
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByTestId("import-preview");
  await expect(preview.locator("li", { hasText: "New" }).first()).toContainText("2");
  await expect(preview).toContainText("Will create categories: E2E Imported Rent, E2E Imported Pay");
  await expect(preview).toContainText("Will create accounts: E2E Old Bank");
  await expect(preview).toContainText("Landlord, Inc.");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /^Import 2 new/ }).click();
  await expect(page.getByTestId("import-result")).toContainText("Added 2 transactions");
  await expect(page.getByTestId("import-result")).toContainText("created 2 categories and 1 account");

  // The data is really there.
  const accounts = (await (await page.request.get("/api/accounts")).json()).accounts as Array<{
    id: string;
    name: string;
    isManual: boolean;
  }>;
  const created = accounts.find((a) => a.name === "E2E Old Bank")!;
  expect(created.isManual).toBe(true);
  const rows = (await (await page.request.get(`/api/transactions?account=${encodeURIComponent(created.id)}`)).json())
    .rows as Array<{ amountCents: number; source: string; displayPayee: string; categoryId: number | null }>;
  expect(rows.map((r) => [r.amountCents, r.source]).sort()).toEqual(
    [
      [-120000, "import"],
      [250000, "import"],
    ].sort(),
  );
  expect(rows.every((r) => r.categoryId !== null)).toBe(true);
  const cats = (await (await page.request.get("/api/categories")).json()).categories as Array<{
    name: string;
    isIncome: boolean;
  }>;
  expect(cats.find((c) => c.name === "E2E Imported Pay")?.isIncome).toBe(true);
  expect(cats.find((c) => c.name === "E2E Imported Rent")?.isIncome).toBe(false);

  // Importing the same file again finds everything already there.
  await page.reload();
  await upload(page);
  await expect(page.getByRole("combobox", { name: "Destination for E2E Old Bank" })).toContainText(
    "E2E Old Bank · Imported",
  );
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByTestId("import-preview").locator("li", { hasText: "New" }).first()).toContainText("0");
  await expect(page.getByTestId("import-preview").locator("li", { hasText: "Matched" }).first()).toContainText("2");
  await expect(page.getByRole("button", { name: /^Import 0 new/ })).toBeVisible();
});

test("the importer refuses a bad mapping and oversized input on the server", async ({ page }) => {
  await login(page);
  const bad = await page.request.post("/api/import/preview", {
    data: {
      csv: CSV,
      hasHeader: true,
      dateFormat: "iso",
      accounts: {},
      mapping: {
        date: 1,
        amount: null,
        debit: null,
        credit: null,
        invertSigns: false,
        payee: 2,
        notes: null,
        category: null,
        account: 0,
      },
    },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).message).toContain("amount");
  const empty = await page.request.post("/api/import/commit", { data: { csv: "" } });
  expect(empty.status()).toBe(400);
});
