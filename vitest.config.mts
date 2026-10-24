import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "src") },
      // `server-only` throws outside of Next's bundler; stub it for unit tests.
      { find: "server-only", replacement: path.resolve(import.meta.dirname, "tests/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    env: { APP_SECRET: "unit-test-secret-unit-test-secret-0123" },
    include: ["tests/unit/**/*.test.ts"],
  },
});
