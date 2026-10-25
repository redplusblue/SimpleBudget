import { defineConfig, devices } from "@playwright/test";

const SEEDED_PORT = Number(process.env.E2E_PORT ?? 3100);
const FRESH_PORT = SEEDED_PORT + 1;
const BIG_PORT = SEEDED_PORT + 2;
const TARGETS_PORT = SEEDED_PORT + 3;
const SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e"; // keep in sync with E2E_SECRET in tests/e2e/helpers.ts

const server = (port: number, db: string) => ({
  // Start from an empty database every run.
  command: `rm -f ${db} ${db}-wal ${db}-shm && pnpm exec next start -p ${port}`,
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { APP_SECRET: SECRET, DATABASE_PATH: db },
});

/** A server whose database is filled by `pnpm db:seed-fake` (~10,000 transactions). */
const bigServer = (port: number, db: string) => ({
  command: `rm -f ${db} ${db}-wal ${db}-shm && pnpm db:seed-fake --setup && pnpm exec next start -p ${port}`,
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 120_000,
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
      testIgnore: /(fresh|big|screenshots|targets|insights|ai|splits|manual)\.spec\.ts/,
      use: {
        ...viewports[name],
        baseURL: `http://127.0.0.1:${SEEDED_PORT}`,
        storageState: "tests/e2e/.auth/state.json",
      },
    })),
    // 10,000 fake transactions: virtualization and running-balance checks.
    {
      name: "big",
      testMatch: /(big|screenshots)\.spec\.ts/,
      use: { ...viewports.desktop, baseURL: `http://127.0.0.1:${BIG_PORT}` },
    },
    // Its own 10,000-transaction install, because the targets spec adds transactions and creates targets.
    {
      name: "targets",
      testMatch: /(targets|insights|ai|splits|manual)\.spec\.ts/,
      use: { ...viewports.desktop, baseURL: `http://127.0.0.1:${TARGETS_PORT}` },
    },
    // Brand-new install, used only by the setup wizard spec.
    {
      name: "fresh-mobile",
      testMatch: /fresh\.spec\.ts/,
      use: { ...viewports.mobile, baseURL: `http://127.0.0.1:${FRESH_PORT}` },
    },
  ],
  webServer: [
    server(SEEDED_PORT, "./data/e2e.db"),
    server(FRESH_PORT, "./data/e2e-fresh.db"),
    bigServer(BIG_PORT, "./data/e2e-big.db"),
    bigServer(TARGETS_PORT, "./data/e2e-targets.db"),
  ],
});
