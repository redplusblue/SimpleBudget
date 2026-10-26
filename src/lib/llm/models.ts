import { z } from "zod";

// Client-safe: the settings UI imports these types and constants.

export const AI_FEATURES = ["rules", "chat", "insights", "trace", "automations", "search", "web"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const FEATURE_LABELS: Record<AiFeature, string> = {
  rules: "Rule suggestions",
  chat: "Assistant chat",
  insights: "Insight cards and monthly summary",
  trace: "Explain a transaction",
  automations: "Automations (starting value)",
  search: "Plain-English search",
  web: "Web research",
};

export interface ModelEntry {
  id: string;
  label?: string;
  /** Optional USD price per million tokens, used to estimate cost when the server doesn't report it. */
  inputPerMTok?: number;
  outputPerMTok?: number;
}

export const MAX_MODELS = 30;

export class ModelListError extends Error {
  readonly code = "invalid" as const;
}

const modelId = z.string().trim().min(1, "A model id can't be empty").max(120, "A model id is too long");
const price = z.number().min(0).max(1000);

const modelObject = z.object({
  id: modelId,
  label: z.string().trim().max(40, "A label can be at most 40 characters").optional(),
  inputPerMTok: price.optional(),
  outputPerMTok: price.optional(),
});

export const modelListSchema = z
  .array(
    z.union([modelId.transform((id): ModelEntry => ({ id })), modelObject], {
      error: (iss) => {
        const v = iss.input;
        const id = typeof v === "string" ? v : (v as { id?: unknown } | null)?.id;
        return typeof id === "string" && id.trim() === "" ? "A model id can't be empty" : "Each model needs an id";
      },
    }),
  )
  .max(MAX_MODELS, `Use at most ${MAX_MODELS} models`)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const m of list) {
      if (seen.has(m.id)) ctx.addIssue({ code: "custom", message: `"${m.id}" is listed twice` });
      seen.add(m.id);
    }
  });

export function parseModelListJson(text: string): ModelEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ModelListError("The model list isn't valid JSON.");
  }
  const parsed = modelListSchema.safeParse(raw);
  if (!parsed.success) throw new ModelListError(parsed.error.issues[0]?.message ?? "The model list isn't valid.");
  return parsed.data;
}
