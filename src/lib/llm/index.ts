import "server-only";
import type { DbLike } from "@/db/open";
import { AiConfigError, getAiConfig, getApiKey, isAllowedModel, modelFor, findModel } from "./config";
import type { AiFeature, ModelEntry } from "./models";
import { createOpenAiCompatibleClient } from "./openai-compatible";
import type { GenerateRequest, LlmClient } from "./types";

export * from "./types";

/** In development only, print exactly what is about to leave the machine (never the key). */
export function withDevLogging(client: LlmClient, log: (...a: unknown[]) => void = console.debug): LlmClient {
  return {
    generate(req: GenerateRequest) {
      log(
        "[ai] request payload",
        JSON.stringify(
          { system: req.system, history: req.history, user: req.user, tools: req.tools?.map((t) => t.name) },
          null,
          2,
        ),
      );
      const runTool = req.runTool;
      return client.generate({
        ...req,
        runTool: runTool
          ? async (name, input) => {
              const out = await runTool(name, input);
              log("[ai] tool result", name, out);
              return out;
            }
          : undefined,
      });
    },
  };
}

/** The configured client, or null when AI is off or incomplete. The app works the same either way. */
export function getLlm(db: DbLike): LlmClient | null {
  const cfg = getAiConfig(db);
  if (!cfg.enabled) return null;
  if (!cfg.baseUrl || !cfg.model) return null;
  const client = createOpenAiCompatibleClient({ apiKey: getApiKey(db), model: cfg.model, baseUrl: cfg.baseUrl });
  return process.env.NODE_ENV === "development" ? withDevLogging(client) : client;
}

export interface FeatureLlm {
  llm: LlmClient;
  model: string;
  entry: ModelEntry | undefined;
}

/**
 * The client for one feature. `requested` is the per-run choice from the UI; it must be in the model list.
 * Returns null when AI is off or incomplete. Throws AiConfigError for a model that isn't allowed.
 */
export function getLlmFor(db: DbLike, feature: AiFeature, requested?: string): FeatureLlm | null {
  const cfg = getAiConfig(db);
  if (!cfg.enabled || !cfg.baseUrl || !cfg.model) return null;
  const model = requested?.trim() || modelFor(cfg, feature);
  if (!isAllowedModel(cfg, model)) throw new AiConfigError("That model isn't in your model list.");
  const client = createOpenAiCompatibleClient({ apiKey: getApiKey(db), model, baseUrl: cfg.baseUrl });
  const llm = process.env.NODE_ENV === "development" ? withDevLogging(client) : client;
  return { llm, model, entry: findModel(cfg, model) };
}
