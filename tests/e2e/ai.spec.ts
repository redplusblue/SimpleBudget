import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, insertExpense } from "./helpers";

// Uses the "targets" project's seeded server. A tiny OpenAI-compatible server stands in for the provider and records
// exactly what the app sends it.
const MOCK_PORT = 3198;
const DB = "./data/e2e-targets.db";
test.describe.configure({ mode: "serial" });

interface Recorded {
  body: {
    model?: string;
    messages: Array<{ role: string; content: string | null; tool_calls?: unknown }>;
    tools?: unknown[];
  };
  auth: string | undefined;
}

let server: Server;
let requests: Recorded[] = [];
let mode: "ok" | "fail" = "ok";

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
const delta = (d: unknown, finish: string | null = null) => ({ choices: [{ delta: d, finish_reason: finish }] });

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (mode === "fail") {
        res.writeHead(500).end("kaboom sk-secret-should-not-appear");
        return;
      }
      const body = JSON.parse(raw);
      requests.push({ body, auth: req.headers.authorization });
      if (String(body.messages[0]?.content).startsWith("You help a personal-budget app write categorization rules")) {
        // Answer for each numbered payee line of the prompt: ZZQ ALPHA -> Dining (high), ZZQ BRAVO -> Shopping, else Other.
        const answers = [...String(body.messages.at(-1)?.content).matchAll(/^(\d+)\. (.+?) \|/gm)].map((m) => {
          const name = m[2].toLowerCase();
          if (name.includes("zzq alpha")) return { i: Number(m[1]), category: "Dining", confidence: "high" };
          if (name.includes("zzq bravo")) return { i: Number(m[1]), category: "Shopping", confidence: "medium" };
          return { i: Number(m[1]), category: "Other", confidence: "low" };
        });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse([delta({ content: JSON.stringify(answers) }, "stop")]));
        return;
      }
      const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
      const sawToolResult = body.messages.some((m: { role: string }) => m.role === "tool");
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (hasTools && !sawToolResult) {
        res.end(
          sse([
            delta(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: {
                      name: "get_category_totals",
                      arguments: JSON.stringify({ month: new Date().toISOString().slice(0, 7) }),
                    },
                  },
                ],
              },
              "tool_calls",
            ),
          ]),
        );
      } else if (hasTools) {
        res.end(sse([delta({ content: "You spent the most on **Groceries**." }, "stop")]));
      } else {
        res.end(
          sse([
            delta({ content: "- Spending was steady this month.\n" }),
            delta({ content: "- Dining was your top category.\n\n## Suggestions\n- Cook at home more." }, "stop"),
          ]),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(MOCK_PORT, "127.0.0.1", resolve));
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Password").fill("password1234");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("with AI off, Insights works and only offers a way to set it up", async ({ page }) => {
  await login(page);
  await page.goto("/insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Set up AI" })).toBeVisible();
  await expect(page.getByTestId("ai-summary")).toHaveCount(0);
  expect((await page.request.post("/api/insights/ask", { data: { question: "hi" } })).status()).toBe(409);
  expect((await page.request.post("/api/insights/summary")).status()).toBe(409);
});

test("configure a provider, then get a streamed summary and an answer that used a tool", async ({ page }) => {
  await login(page);
  await page.goto("/settings/ai");
  await expect(page.getByText("Only aggregated data is sent")).toBeVisible();
  await page.getByLabel("Turn on AI features").click();
  await page.getByLabel("Server address").fill(`http://127.0.0.1:${MOCK_PORT}/v1`);
  await page.getByLabel("Default model", { exact: true }).fill("mock-model");
  await page.getByLabel(/API key/).fill("sk-test-key-123456");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("AI settings saved")).toBeVisible();
  await expect(page.getByLabel(/API key/)).toHaveAttribute("placeholder", /Saved/);

  // The key is write-only.
  const cfg = await (await page.request.get("/api/settings/ai")).json();
  expect(JSON.stringify(cfg)).not.toContain("sk-test-key");
  expect(cfg.config).toMatchObject({
    enabled: true,
    model: "mock-model",
    hasKey: true,
    includeBalances: false,
  });

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connected. The provider answered.")).toBeVisible();

  requests = [];
  await page.goto("/insights");
  await page.getByRole("button", { name: "Write summary" }).click();
  const summary = page.getByTestId("ai-summary");
  await expect(summary).toContainText("Dining was your top category");
  await expect(summary.getByRole("heading", { name: "Suggestions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();

  // The saved summary is still there after a reload (cached until the next sync).
  await page.reload();
  await expect(page.getByTestId("ai-summary")).toContainText("Dining was your top category");

  await page.getByLabel("Your question").fill("Where does my money go?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("ai-chat")).toContainText("You spent the most on");
  await expect(page.getByTestId("ai-chat").locator("strong")).toHaveText("Groceries");

  // Acceptance: nothing identifying left the server.
  expect(requests.length).toBeGreaterThanOrEqual(3);
  const all = JSON.stringify(requests.map((r) => r.body));
  for (const secret of [
    "fake-checking",
    "fake-credit",
    "fake-savings",
    "access_url",
    "bridge.simplefin",
    "sk-test-key",
  ])
    expect(all).not.toContain(secret);
  expect(requests[0].auth).toBe("Bearer sk-test-key-123456");
  const toolResult = requests.flatMap((r) => r.body.messages).find((m) => m.role === "tool");
  expect(toolResult?.content).toContain("categories");
});

test("a failing provider degrades gracefully and the insights stay visible", async ({ page }) => {
  await login(page);
  mode = "fail";
  try {
    await page.goto("/insights");
    await page.getByRole("button", { name: /Regenerate|Write summary/ }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Your insights below are unaffected" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("The AI provider returned an error (500)");
    await expect(alert).not.toContainText("sk-secret");
    await expect(page.getByTestId("insights-list").or(page.getByText("Nothing notable right now"))).toBeVisible();
  } finally {
    mode = "ok";
  }
});

test("a model list lets the Ask box pick a model for one request", async ({ page }) => {
  await login(page);
  const put = await page.request.put("/api/settings/ai", {
    data: {
      models: [
        { id: "mock-model", label: "Cheap" },
        { id: "mock-smart", label: "Smart" },
      ],
      featureModels: { chat: "mock-model" },
    },
  });
  expect(put.status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/insights");
  await page.getByLabel("Model for this request").last().click();
  await page.getByRole("option", { name: "Smart" }).click();
  requests = [];
  await page.getByLabel("Your question").fill("Where does my money go?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("ai-chat")).toContainText("You spent the most on");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((r) => r.body.model === "mock-smart")).toBe(true);
  await expectNoHorizontalOverflow(page);

  // A model outside the list is refused by the server.
  const bad = await page.request.post("/api/insights/ask", { data: { question: "hi", model: "not-listed" } });
  expect(bad.status()).toBe(400);

  await page.goto("/settings/ai");
  await expect(page.getByText("AI usage this month")).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent AI requests" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.request.put("/api/settings/ai", { data: { models: null, featureModels: null } });
});

test("AI suggests rules; accept one with a changed category, dismiss another, and it isn't asked again", async ({
  page,
}) => {
  await login(page);
  const cfg = await page.request.put("/api/settings/ai", {
    data: { enabled: true, baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: "mock-model" },
  });
  expect(cfg.status()).toBe(200);
  for (const n of [1, 2]) {
    insertExpense(DB, { accountId: "fake-checking", description: `ZZQ ALPHA STORE #${n}`, dollars: 12 });
    insertExpense(DB, { accountId: "fake-checking", description: `ZZQ BRAVO SHOP #${n}`, dollars: 30 });
  }

  await page.goto("/rules");
  await page.getByRole("button", { name: "Find suggestions" }).click();
  const alpha = page.getByTestId("ai-suggestion").filter({ hasText: /zzq alpha/i });
  const bravo = page.getByTestId("ai-suggestion").filter({ hasText: /zzq bravo/i });
  await expect(alpha).toBeVisible();
  await expect(bravo).toBeVisible();
  await expect(alpha).toContainText("high confidence");
  await expect(alpha).toContainText("Matches 2");

  // A phone shows the suggestions without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Change the category before accepting: the rule follows the owner's choice.
  await bravo.getByRole("combobox").click();
  await page.getByRole("option", { name: "Groceries" }).click();
  await bravo.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(/Rule "AI · Groceries" saved · 2 transactions updated/)).toBeVisible();
  await expect(bravo).toHaveCount(0);
  await expect(page.getByText("AI · Groceries").first()).toBeVisible();

  await alpha.getByRole("button", { name: "Dismiss" }).click();
  await expect(alpha).toHaveCount(0);

  // A second run never asks about a dismissed (or accepted) merchant again.
  requests = [];
  const find = page.getByRole("button", { name: "Find suggestions" });
  if (await find.isEnabled()) {
    await find.click();
    await expect(page.getByText(/No new suggestions|new suggestion/).first()).toBeVisible();
  }
  expect(JSON.stringify(requests.map((r) => r.body)).toLowerCase()).not.toContain("zzq alpha");
  await expect(alpha).toHaveCount(0);

  await page.getByRole("button", { name: "Show dismissed" }).click();
  await expect(page.getByRole("list", { name: "Dismissed suggestions" })).toContainText(/zzq alpha/i);
  await page.getByRole("button", { name: "Ask again" }).first().click();
});

test("the AI settings and panel fit a phone, and AI can be turned off again", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/insights");
  await expect(page.getByTestId("ai-summary")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto("/settings/ai");
  await expect(page.getByLabel("Server address")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel("Turn on AI features").click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("AI settings saved")).toBeVisible();
  await page.goto("/insights");
  await expect(page.getByRole("link", { name: "Set up AI" })).toBeVisible();
});
