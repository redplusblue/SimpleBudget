import "server-only";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { decrypt, encrypt } from "@/lib/crypto";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { AI_FEATURES, FEATURE_LABELS, modelListSchema, type AiFeature, type ModelEntry } from "./models";
import { DEFAULT_BASE_URL } from "./types";

const KEYS = {
  enabled: "ai:enabled",
  model: "ai:model",
  baseUrl: "ai:base_url",
  includeBalances: "ai:include_balances",
  apiKey: "ai:api_key",
  models: "ai:models",
  featureModels: "ai:feature_models",
  budget: "ai:monthly_budget_micros",
  userName: "ai:user_name",
} as const;

/** What the settings page may see. The key itself never leaves the server. */
export interface AiConfig {
  enabled: boolean;
  model: string;
  baseUrl: string;
  /** Also share account names and balances (off unless the user opts in). */
  includeBalances: boolean;
  hasKey: boolean;
  /** The allowed models. Never empty when `model` is set: falls back to [{ id: model }]. */
  models: ModelEntry[];
  /** Explicit per-feature choices only; use `modelFor()` to resolve. */
  featureModels: Partial<Record<AiFeature, string>>;
  /** Monthly cap in micro-USD, or null for none. */
  monthlyBudgetMicros: number | null;
  /** First name used in insight cards; empty when not set. */
  userName: string;
}

export class AiConfigError extends Error {
  readonly code = "invalid" as const;
}

function readJsonSetting(db: DbLike, key: string): unknown {
  const raw = getSetting(db, key);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readStoredModels(db: DbLike): ModelEntry[] {
  const parsed = modelListSchema.safeParse(readJsonSetting(db, KEYS.models));
  return parsed.success ? parsed.data : [];
}

function readModels(db: DbLike, fallback: string): ModelEntry[] {
  const stored = readStoredModels(db);
  if (stored.length > 0) return stored;
  return fallback ? [{ id: fallback }] : [];
}

function readFeatureModels(db: DbLike): Partial<Record<AiFeature, string>> {
  const raw = readJsonSetting(db, KEYS.featureModels);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Partial<Record<AiFeature, string>> = {};
  for (const f of AI_FEATURES) {
    const v = (raw as Record<string, unknown>)[f];
    if (typeof v === "string" && v.trim()) out[f] = v;
  }
  return out;
}

function readBudget(db: DbLike): number | null {
  const raw = getSetting(db, KEYS.budget);
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function getAiConfig(db: DbLike): AiConfig {
  const model = getSetting(db, KEYS.model) ?? "";
  return {
    enabled: getSetting(db, KEYS.enabled) === "1",
    model,
    models: readModels(db, model),
    featureModels: readFeatureModels(db),
    monthlyBudgetMicros: readBudget(db),
    userName: getSetting(db, KEYS.userName) ?? "",
    baseUrl: getSetting(db, KEYS.baseUrl) ?? DEFAULT_BASE_URL,
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
    model: z.string().trim().min(1, "Enter a model name").max(120),
    baseUrl: httpUrl.min(1, "Enter the server address"),
    includeBalances: z.boolean(),
    /** A string replaces the saved key; null removes it. */
    apiKey: z.string().trim().min(8, "That key looks too short").max(500).nullable(),
    /** The parsed list; null clears it. */
    models: modelListSchema.nullable(),
    featureModels: z.partialRecord(z.enum(AI_FEATURES), z.string().trim().min(1).max(120)).nullable(),
    monthlyBudgetMicros: z.number().int().min(0).max(10_000_000_000).nullable(),
    /** Empty clears it. */
    userName: z.string().trim().max(40),
  })
  .partial()
  .strict();

export type AiConfigPatch = z.input<typeof aiConfigPatchSchema>;

/** Applies a patch after checking that the resulting configuration is usable when enabled. */
export function updateAiConfig(db: DbLike, input: unknown): AiConfig {
  const patch = aiConfigPatchSchema.parse(input);
  const next = {
    ...getAiConfig(db),
    ...Object.fromEntries(Object.entries(patch).filter(([k]) => !["apiKey", "models", "featureModels"].includes(k))),
  } as AiConfig;
  // The key is optional: a local server (Open WebUI, Ollama) may not need one. Hosted services like OpenRouter do.
  if (next.enabled) {
    if (!next.baseUrl) throw new AiConfigError("Enter the server address before turning AI on.");
    if (!next.model.trim()) throw new AiConfigError("Enter a model name before turning AI on.");
  }
  const list: ModelEntry[] | null | undefined = patch.models;
  const current = getAiConfig(db);
  const storedList = list === undefined ? readStoredModels(db) : (list ?? []);
  const effective = storedList.length > 0 ? storedList : next.model ? [{ id: next.model }] : [];
  const ids = new Set(effective.map((m) => m.id));
  const features = patch.featureModels === undefined ? current.featureModels : (patch.featureModels ?? {});
  for (const [f, id] of Object.entries(features)) {
    if (!ids.has(id) && id !== next.model) {
      throw new AiConfigError(`${FEATURE_LABELS[f as AiFeature]} uses a model that isn't in your list.`);
    }
  }
  if (storedList.length > 0 && next.model && !ids.has(next.model)) {
    throw new AiConfigError("The default model must be in your list.");
  }
  db.transaction((tx) => {
    if (patch.enabled !== undefined) setSetting(tx, KEYS.enabled, patch.enabled ? "1" : "0");
    if (patch.model !== undefined) setSetting(tx, KEYS.model, patch.model);
    if (patch.baseUrl !== undefined) setSetting(tx, KEYS.baseUrl, patch.baseUrl);
    if (patch.includeBalances !== undefined) setSetting(tx, KEYS.includeBalances, patch.includeBalances ? "1" : "0");
    if (patch.models === null) deleteSetting(tx, KEYS.models);
    else if (patch.models !== undefined) setSetting(tx, KEYS.models, JSON.stringify(patch.models));
    if (patch.featureModels === null) deleteSetting(tx, KEYS.featureModels);
    else if (patch.featureModels !== undefined) setSetting(tx, KEYS.featureModels, JSON.stringify(patch.featureModels));
    if (patch.monthlyBudgetMicros === null) deleteSetting(tx, KEYS.budget);
    else if (patch.monthlyBudgetMicros !== undefined) setSetting(tx, KEYS.budget, String(patch.monthlyBudgetMicros));
    if (patch.userName !== undefined) {
      if (patch.userName === "") deleteSetting(tx, KEYS.userName);
      else setSetting(tx, KEYS.userName, patch.userName);
    }
    if (patch.apiKey === null) deleteSetting(tx, KEYS.apiKey);
    else if (patch.apiKey !== undefined) setSetting(tx, KEYS.apiKey, encrypt(patch.apiKey));
  });
  return getAiConfig(db);
}

/** The model a feature uses when the caller doesn't ask for one. */
export function modelFor(cfg: AiConfig, feature: AiFeature): string {
  return cfg.featureModels[feature] ?? cfg.model;
}

/** Whether `id` may be used (it is in the list, or equals the fallback default). */
export function isAllowedModel(cfg: AiConfig, id: string): boolean {
  return id === cfg.model || cfg.models.some((m) => m.id === id);
}

export function findModel(cfg: AiConfig, id: string): ModelEntry | undefined {
  return cfg.models.find((m) => m.id === id);
}
