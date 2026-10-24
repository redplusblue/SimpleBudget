import { defineConfig, devices } from "@playwright/test";

const SEEDED_PORT = Number(process.env.E2E_PORT ?? 3100);
const FRESH_PORT = SEEDED_PORT + 1;
const SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e";

const server = (port: number, db: string) => ({
  // Start from an empty database every run.
  command: `rm -f ${db} ${db}-wal ${db}-shm && pnpm exec next start -p ${port}`,
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { APP_SECRET: SECRET, DATABASE_PATH: db },
});

const viewports = {
  desktop: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  mobile: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { trace: "on-first-retry" },
  projects: [
    // Pre-configured install (password set, one connection, logged in via storageState).
    ...(["desktop", "mobile"] as const).map((name) => ({
      name,
      testIgnore: /fresh\.spec\.ts/,
      use: {
        ...viewports[name],
        baseURL: `http://127.0.0.1:${SEEDED_PORT}`,
        storageState: "tests/e2e/.auth/state.json",
      },
    })),
    // Brand-new install, used only by the setup wizard spec.
    {
      name: "fresh-mobile",
      testMatch: /fresh\.spec\.ts/,
      use: { ...viewports.mobile, baseURL: `http://127.0.0.1:${FRESH_PORT}` },
    },
  ],
  webServer: [server(SEEDED_PORT, "./data/e2e.db"), server(FRESH_PORT, "./data/e2e-fresh.db")],
});
