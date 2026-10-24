import "server-only";
import { z } from "zod";

const schema = z.object({
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  DATABASE_PATH: z.string().min(1).default("./data/simplebudget.db"),
  TZ: z.string().min(1).default("UTC"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Set to "true" when served over HTTPS so the session cookie is marked Secure. */
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` and unit tests don't need every variable. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper. */
export function resetEnvCache() {
  cached = undefined;
}
