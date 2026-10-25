import Anthropic from "@anthropic-ai/sdk";
import { clip, DEFAULT_MAX_TOKENS, LlmError, MAX_TOOL_ROUNDS, type GenerateRequest, type LlmClient } from "./types";

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new LlmError("The AI provider rejected the API key.", "auth");
  if (e instanceof Anthropic.RateLimitError)
    return new LlmError("The AI provider is rate limiting requests. Try again shortly.", "rate_limit");
  if (e instanceof Anthropic.NotFoundError)
    return new LlmError("The AI provider doesn't know that model. Check the model name.", "bad_response");
  if (e instanceof Anthropic.APIConnectionError) return new LlmError("Couldn't reach the AI provider.", "unavailable");
  if (e instanceof Anthropic.APIError)
    return new LlmError(`The AI provider returned an error (${e.status ?? "unknown"}).`, "unavailable");
  return new LlmError("Something went wrong talking to the AI provider.", "unavailable");
}

export function createAnthropicClient(opts: { apiKey: string; model: string; baseUrl?: string }): LlmClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    maxRetries: 1,
  });
  return {
    async generate(req: GenerateRequest) {
      const messages: Anthropic.MessageParam[] = [
        ...(req.history ?? []).map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: req.user },
      ];
      const tools: Anthropic.Tool[] | undefined = req.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      let text = "";
      try {
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const stream = client.messages.stream(
            {
              model: opts.model,
              max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
              system: req.system,
              messages,
              ...(tools?.length ? { tools } : {}),
            },
            { signal: req.signal },
          );
          stream.on("text", (delta) => {
            text += delta;
            req.onText?.(delta);
          });
          const message = await stream.finalMessage();
          if (message.stop_reason === "refusal")
            throw new LlmError("The AI provider declined to answer that.", "declined");
          if (message.stop_reason !== "tool_use" || !req.runTool) return text.trim();

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            try {
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: clip(await req.runTool(block.name, block.input)),
              });
            } catch (e) {
              results.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: e instanceof Error ? e.message : "Tool failed",
                is_error: true,
              });
            }
          }
          messages.push({ role: "user", content: results });
          if (text && !text.endsWith("\n")) {
            text += "\n\n"; // keep text from before and after a tool call apart
            req.onText?.("\n\n");
          }
        }
      } catch (e) {
        throw toLlmError(e);
      }
      throw new LlmError("The AI provider needed too many steps to answer.", "bad_response");
    },
  };
}
