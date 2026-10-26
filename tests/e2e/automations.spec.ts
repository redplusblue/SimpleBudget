import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, insertExpense } from "./helpers";

// Shares the "targets" project's 10,000-transaction install. A tiny HTTP server stands in for a webhook destination
// and records exactly what automations send it. Nothing here uses AI.
const HOOK_PORT = 3196;
const DB = "./data/e2e-targets.db";
test.describe.configure({ mode: "serial" });

let server: Server;
let received: Array<{ path: string; body: Record<string, unknown> }> = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(HOOK_PORT, "127.0.0.1", resolve));
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function pick(page: Page, label: string, option: string | RegExp) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}

test("a transaction automation sends its rendered message to a webhook destination", async ({ page }) => {
  await login(page);
  await page.goto("/settings/automations");
  await expect(page.getByText("No destinations yet")).toBeVisible();
  await expect(page.getByText("No automations yet")).toBeVisible();

  // A destination: its address is write-only.
  await page.getByRole("button", { name: "Add destination" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E hook");
  await pick(page, "Send through", /Webhook/);
  await page.getByLabel("Address", { exact: true }).fill(`http://127.0.0.1:${HOOK_PORT}/secret-hook-path`);
  await page.getByRole("button", { name: "Add destination" }).last().click();
  await expect(page.getByTestId("destination")).toContainText("E2E hook");
  const listed = await (await page.request.get("/api/automations/destinations")).text();
  expect(listed).not.toContain("secret-hook-path");

  // The test message reaches it.
  await page.getByRole("button", { name: "Send a test to E2E hook" }).click();
  await expect(page.getByText("Sent. Check the destination.")).toBeVisible();
  expect(received.at(-1)?.path).toBe("/secret-hook-path");

  // An automation: when a matching transaction arrives, send a message.
  await page.getByRole("button", { name: "New automation" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Big spend");
  await pick(page, "Trigger", /matching transaction/);
  await page.getByLabel("Condition 1 value").fill("1");
  await pick(page, "Action", /Send a message/);
  await page.getByLabel("Message", { exact: true }).fill("{payee} charged {amount}");
  await pick(page, "Destination", "E2E hook");
  await page.getByLabel("Include payee and account names").check();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const row = page.getByTestId("automation").filter({ hasText: "Big spend" });
  await expect(row).toContainText("When a matching transaction arrives");
  await expect(row).toContainText("E2E hook");

  // Run now uses the newest matching transaction as the example.
  insertExpense(DB, { accountId: "fake-checking", description: "E2E AUTOMATION SHOP", dollars: 12.34 });
  received = [];
  await row.getByRole("button", { name: "Actions for Big spend" }).click();
  await page.getByRole("menuitem", { name: "Run now" }).click();
  await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
  expect(received).toHaveLength(1);
  const embedOrMessage = JSON.stringify(received[0].body);
  expect(embedOrMessage).toContain("E2E AUTOMATION SHOP charged $12.34");

  // History shows the run.
  await row.getByRole("button", { name: "Actions for Big spend" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  await expect(page.getByTestId("automation-run").first()).toContainText("E2E AUTOMATION SHOP charged $12.34");
  await page.keyboard.press("Escape");

  // A destination in use can't be deleted.
  const dests = (await (await page.request.get("/api/automations/destinations")).json()).destinations as Array<{
    id: number;
  }>;
  const refused = await page.request.delete(`/api/automations/destinations/${dests[0].id}`);
  expect(refused.status()).toBe(409);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test("the automation editor and list fit a phone, and an automation can be disabled and deleted", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/automations");
  await page.getByRole("button", { name: "New automation" }).click();
  await expect(page.getByLabel("Trigger", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Escape");

  const row = page.getByTestId("automation").filter({ hasText: "Big spend" });
  await row.getByRole("switch", { name: "Enable Big spend" }).click();
  await expect(row.getByRole("switch", { name: "Enable Big spend" })).not.toBeChecked();
  await row.getByRole("button", { name: "Actions for Big spend" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("automation")).toHaveCount(0);
});
