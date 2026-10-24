import { expect, test } from "@playwright/test";
import { PASSWORD } from "./helpers";

test.describe("logged in", () => {
  test("settings: connections list, add dialog and remove confirmation", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/connections$/);
    await expect(page.getByText("First Test Bank")).toBeVisible();
    await expect(page.getByText(/3 accounts/)).toBeVisible();

    await page.getByRole("button", { name: "Add another setup token" }).click();
    const token = page.getByRole("textbox", { name: "Setup token" });
    await expect(token).toBeVisible();
    await token.fill("not a token!");
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("doesn't look like a SimpleFIN setup token");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Remove First Test Bank connection" }).click();
    const sw = page.getByRole("switch", { name: /delete its imported data/i });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("First Test Bank")).toBeVisible();
  });

  test("log out then log in again", async ({ page }) => {
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/accounts");
    await expect(page).toHaveURL(/\/login\?next=%2Faccounts$/);
    await page.getByLabel("Password").fill("wrong password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText("Incorrect password.");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
  });

  test("/setup redirects home once setup is complete", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("logged out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("API routes return 401", async ({ request }) => {
    for (const path of ["/api/connections", "/api/setup/complete"]) {
      const res = path.endsWith("complete") ? await request.post(path) : await request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });

  test("pages redirect to login", async ({ page }) => {
    await page.goto("/spending");
    await expect(page).toHaveURL(/\/login\?next=%2Fspending$/);
  });
});
