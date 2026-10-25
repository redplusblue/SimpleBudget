import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/fetch-json";
import type { AiConfig } from "@/lib/llm/config";

export const AI_CONFIG_KEY = ["ai-config"] as const;

// Type-only import: the server module itself never reaches the browser bundle.
export type { AiConfig };

export function useAiConfig() {
  return useQuery({
    queryKey: AI_CONFIG_KEY,
    queryFn: async () => (await fetchJson<{ config: AiConfig }>("/api/settings/ai")).config,
    staleTime: 30_000,
  });
}
