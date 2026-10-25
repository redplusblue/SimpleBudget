import fs from "node:fs";
import { expectNoHorizontalOverflow, revealLazy } from "./helpers";
import { expect, test } from "@playwright/test";

// `SCREENSHOTS=1 pnpm test:e2e --project=big tests/e2e/screenshots.spec.ts` refreshes docs/screenshots/.
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate docs/screenshots");

const SIZES = [
  { width: 390, height: 844, name: "390" },
  { width: 768, height: 1024, name: "768" },
  { width: 1440, height: 900, name: "1440" },
] as const;

test("dashboard screenshots at 390, 768 and 1440px", async ({ page }) => {
  fs.mkdirSync("docs/screenshots", { recursive: true });
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const { width, height, name } of SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await revealLazy(page);
    await expect(page.getByTestId("nw-change")).toBeVisible();
    await expect(page.getByTestId("category-donut")).toBeVisible();
    await page.waitForTimeout(1200); // count-up and chart settle
    await expectNoHorizontalOverflow(page);
    // A full-page capture would pin the fixed mobile tab bar in the middle of the page, so hide it for the shot.
    await page.addStyleTag({ content: "nav.fixed { display: none !important; }" });
    await page.screenshot({ path: `docs/screenshots/dashboard-${name}.png`, fullPage: true });
  }
});
