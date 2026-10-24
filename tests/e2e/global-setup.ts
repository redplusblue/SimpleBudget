import fs from "node:fs";
import { request, type FullConfig } from "@playwright/test";
import { insertConnection, MOCK_PORT, PASSWORD } from "./helpers";
import { startMockSimpleFin } from "./mock-simplefin";

/** Configures the seeded server once (password, mock bank, imported data) and saves a logged-in session. */
export default async function globalSetup(config: FullConfig) {
  const mock = await startMockSimpleFin(MOCK_PORT);
  const baseURL = config.projects[0].use.baseURL!;
  const ctx = await request.newContext({ baseURL });

  const created = await ctx.post("/api/setup/password", { data: { password: PASSWORD } });
  if (!created.ok()) throw new Error(`setup/password failed: ${created.status()}`);

  insertConnection("./data/e2e.db", mock.accessUrl);
  const started = await ctx.post("/api/sync", { data: { mode: "backfill", days: 90 } });
  if (started.status() !== 202) throw new Error(`sync failed to start: ${started.status()} ${await started.text()}`);
  for (let i = 0; i < 60; i++) {
    const status = await (await ctx.get("/api/sync/status")).json();
    if (!status.running && status.lastRun) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const status = await (await ctx.get("/api/sync/status")).json();
  if (status.lastRun?.status !== "ok") throw new Error(`seed sync did not succeed: ${JSON.stringify(status.lastRun)}`);

  const done = await ctx.post("/api/setup/complete");
  if (!done.ok()) throw new Error(`setup/complete failed: ${done.status()}`);
  fs.mkdirSync("tests/e2e/.auth", { recursive: true });
  await ctx.storageState({ path: "tests/e2e/.auth/state.json" });
  await ctx.dispose();

  // The fresh-install spec starts its own sync against the same mock, so it stays up for the whole run.
  return () => mock.close();
}
