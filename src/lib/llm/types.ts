// The one interface the rest of the app talks to, whichever provider is behind it.

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input object. */
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  system: string;
  user: string;
  /** Earlier turns of a conversation, oldest first. */
  history?: ChatTurn[];
  /** Read-only tools the model may call; `runTool` executes them and returns the text result. */
  tools?: LlmTool[];
  runTool?: (name: string, input: unknown) => Promise<string> | string;
  /** Called with each piece of the answer as it arrives (enables streaming). */
  onText?: (delta: string) => void;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmClient {
  generate(req: GenerateRequest): Promise<string>;
}

/** Anything that goes wrong talking to a provider. The message is safe to show to the user. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limit" | "declined" | "unavailable" | "bad_response" = "unavailable",
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export const MAX_TOOL_ROUNDS = 6;
export const DEFAULT_MAX_TOKENS = 4096;
export const MAX_TOOL_RESULT_CHARS = 20_000;

export const clip = (s: string) =>
  s.length > MAX_TOOL_RESULT_CHARS ? `${s.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated]` : s;

export const PROVIDERS = ["anthropic", "openai-compatible"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const DEFAULT_MODEL = "claude-sonnet-5-5";
