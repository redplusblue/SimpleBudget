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

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens the provider served from its cache, when it says so. */
  cachedTokens: number;
  /** Cost in micro-USD when the server reports it (OpenRouter does), else null. */
  costMicros: number | null;
}

export interface Citation {
  url: string;
  title?: string;
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
  /** Called once per provider round-trip with that round's usage (a tool-using answer has several rounds). */
  onUsage?: (usage: LlmUsage) => void;
  /**
   * Extra fields merged into the request body (e.g. OpenRouter's `plugins`). Only server code sets this; they are
   * added first, so they can never override the model, messages or token limit.
   */
  extraBody?: Record<string, unknown>;
  /** Sources the provider cites for a web-backed answer, when it says so. Called once per round with any found. */
  onAnnotations?: (citations: Citation[]) => void;
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

/** Prefilled in settings: OpenRouter. Any server that speaks the OpenAI chat-completions protocol works instead. */
export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
