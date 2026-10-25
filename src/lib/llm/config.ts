import "server-only";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { decrypt, encrypt } from "@/lib/crypto";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { DEFAULT_MODEL, PROVIDERS, type Provider } from "./types";

const KEYS = {
  enabled: "ai:enabled",
  provider: "ai:provider",
  model: "ai:model",
  baseUrl: "ai:base_url",
  includeBalances: "ai:include_balances",
  apiKey: "ai:api_key",
} as const;

/** What the settings page may see. The key itself never leaves the server. */
export interface AiConfig {
  enabled: boolean;
  provider: Provider;
  model: string;
  baseUrl: string;
  /** Also share account names and balances (off unless the user opts in). */
  includeBalances: boolean;
  hasKey: boolean;
}

export class AiConfigError extends Error {
  readonly code = "invalid" as const;
}

export function getAiConfig(db: DbLike): AiConfig {
  const provider = getSetting(db, KEYS.provider);
  return {
    enabled: getSetting(db, KEYS.enabled) === "1",
    provider: PROVIDERS.includes(provider as Provider) ? (provider as Provider) : "anthropic",
    model: getSetting(db, KEYS.model) || DEFAULT_MODEL,
    baseUrl: getSetting(db, KEYS.baseUrl) ?? "",
    includeBalances: getSetting(db, KEYS.includeBalances) === "1",
    hasKey: getSetting(db, KEYS.apiKey) !== undefined,
  };
}

/** Decrypted key, for building a client. Throws if the stored value can't be read (e.g. APP_SECRET changed). */
export function getApiKey(db: DbLike): string | undefined {
  const blob = getSetting(db, KEYS.apiKey);
  return blob === undefined ? undefined : decrypt(blob);
}

const httpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Use a full URL starting with http:// or https://");

export const aiConfigPatchSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(PROVIDERS),
    model: z.string().trim().min(1, "Enter a model name").max(120),
    baseUrl: httpUrl,
    includeBalances: z.boolean(),
    /** A string replaces the saved key; null removes it. */
    apiKey: z.string().trim().min(8, "That key looks too short").max(500).nullable(),
  })
  .partial()
  .strict();

export type AiConfigPatch = z.input<typeof aiConfigPatchSchema>;

/** Applies a patch after checking that the resulting configuration is usable when enabled. */
export function updateAiConfig(db: DbLike, input: unknown): AiConfig {
  const patch = aiConfigPatchSchema.parse(input);
  const next = {
    ...getAiConfig(db),
    ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "apiKey")),
  } as AiConfig;
  const hasKey = patch.apiKey === undefined ? next.hasKey : patch.apiKey !== null;
  if (next.enabled) {
    if (next.provider === "anthropic" && !hasKey) throw new AiConfigError("Add an API key before turning AI on.");
    if (next.provider === "openai-compatible" && !next.baseUrl)
      throw new AiConfigError("Enter the provider's base URL before turning AI on.");
  }
  db.transaction((tx) => {
    if (patch.enabled !== undefined) setSetting(tx, KEYS.enabled, patch.enabled ? "1" : "0");
    if (patch.provider !== undefined) setSetting(tx, KEYS.provider, patch.provider);
    if (patch.model !== undefined) setSetting(tx, KEYS.model, patch.model);
    if (patch.baseUrl !== undefined) setSetting(tx, KEYS.baseUrl, patch.baseUrl);
    if (patch.includeBalances !== undefined) setSetting(tx, KEYS.includeBalances, patch.includeBalances ? "1" : "0");
    if (patch.apiKey === null) deleteSetting(tx, KEYS.apiKey);
    else if (patch.apiKey !== undefined) setSetting(tx, KEYS.apiKey, encrypt(patch.apiKey));
  });
  return getAiConfig(db);
}
