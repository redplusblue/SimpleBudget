import { expect, test } from "@playwright/test";

// Shares the "targets" project's seeded server. Pages must load without console errors, CSP violations or 404s.
const PAGES = [
  "/",
  "/transactions",
  "/spending",
  "/accounts",
  "/insights",
  "/rules",
  "/settings/connections",
  "/settings/about",
];

test("main pages load cleanly: no console errors, CSP violations or failed requests", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/auth/")) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
    );
  });

  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.mouse.wheel(0, 3000); // scroll so lazily mounted cards load too
    await page.waitForTimeout(300);
  }
  expect(problems).toEqual([]);
});
