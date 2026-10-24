import fs from "node:fs";
import { request, type FullConfig } from "@playwright/test";
import { insertConnection, PASSWORD } from "./helpers";

/** Configures the seeded server once and saves a logged-in session for the other specs. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const ctx = await request.newContext({ baseURL });
  const created = await ctx.post("/api/setup/password", { data: { password: PASSWORD } });
  if (!created.ok()) throw new Error(`setup/password failed: ${created.status()}`);
  insertConnection("./data/e2e.db");
  const done = await ctx.post("/api/setup/complete");
  if (!done.ok()) throw new Error(`setup/complete failed: ${done.status()}`);
  fs.mkdirSync("tests/e2e/.auth", { recursive: true });
  await ctx.storageState({ path: "tests/e2e/.auth/state.json" });
  await ctx.dispose();
}
