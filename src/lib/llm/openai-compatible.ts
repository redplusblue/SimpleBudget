import {
  clip,
  DEFAULT_MAX_TOKENS,
  LlmError,
  MAX_TOOL_ROUNDS,
  type GenerateRequest,
  type LlmClient,
  type LlmUsage,
} from "./types";

// Plain fetch against any server that speaks the OpenAI chat-completions protocol (OpenAI, Ollama, LM Studio, ...).

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

/** Reads a server-sent-events body, yielding each `data:` payload. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith("data:")) yield rest.slice(5).trim();
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Maps the OpenAI-style `usage` object (OpenRouter adds `cost` in USD) to our shape. */
function toUsage(u: Record<string, unknown>): LlmUsage {
  const details = u.prompt_tokens_details as Record<string, unknown> | null | undefined;
  const cost = typeof u.cost === "number" && Number.isFinite(u.cost) ? Math.round(u.cost * 1_000_000) : null;
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    cachedTokens: num(details?.cached_tokens),
    costMicros: cost,
  };
}

export function createOpenAiCompatibleClient(opts: { apiKey?: string; model: string; baseUrl: string }): LlmClient {
  return {
    async generate(req: GenerateRequest) {
      const messages: ChatMessage[] = [
        { role: "system", content: req.system },
        ...(req.history ?? []).map((t): ChatMessage => ({ role: t.role, content: t.content })),
        { role: "user", content: req.user },
      ];
      const tools = req.tools?.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      let text = "";
      // Some models (and some proxies in front of them) reject the `tools` parameter; then we answer without lookups.
      let useTools = true;
      // Likewise for `stream_options` (asks for a final usage chunk); tried once, then dropped for the rest of the call.
      let useStreamOptions = true;

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let res: Response;
        try {
          const send = (tokenField: "max_tokens" | "max_completion_tokens") =>
            fetch(endpoint(opts.baseUrl), {
              method: "POST",
              signal: req.signal,
              headers: {
                "content-type": "application/json",
                ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: opts.model,
                messages,
                [tokenField]: req.maxTokens ?? DEFAULT_MAX_TOKENS,
                stream: true,
                ...(useStreamOptions ? { stream_options: { include_usage: true } } : {}),
                ...(tools?.length && useTools ? { tools } : {}),
              }),
            });
          let field: "max_tokens" | "max_completion_tokens" = "max_tokens";
          res = await send(field);
          // Newer OpenAI models refuse `max_tokens` and ask for `max_completion_tokens`; most servers accept the first.
          if (
            res.status === 400 &&
            /max_completion_tokens/.test(
              await res
                .clone()
                .text()
                .catch(() => ""),
            )
          ) {
            field = "max_completion_tokens";
            res = await send(field);
          }
          if (
            res.status === 400 &&
            useStreamOptions &&
            /stream_options/.test(
              await res
                .clone()
                .text()
                .catch(() => ""),
            )
          ) {
            useStreamOptions = false;
            res = await send(field);
          }
          if (res.status === 400 && useTools && tools?.length && round === 0) {
            useTools = false;
            res = await send("max_tokens");
          }
        } catch {
          throw new LlmError("Couldn't reach the AI provider.", "unavailable");
        }
        if (res.status === 401 || res.status === 403)
          throw new LlmError("The AI provider rejected the API key.", "auth");
        if (res.status === 429)
          throw new LlmError("The AI provider is rate limiting requests. Try again shortly.", "rate_limit");
        if (res.status === 404)
          throw new LlmError("The AI provider doesn't know that model or URL. Check the settings.", "bad_response");
        if (!res.ok || !res.body)
          throw new LlmError(`The AI provider returned an error (${res.status}).`, "unavailable");

        let content = "";
        const calls = new Map<number, ToolCall>();
        let finish: string | null = null;
        let usage: LlmUsage | undefined;
        try {
          for await (const data of sse(res.body)) {
            if (data === "[DONE]") break;
            const parsed = JSON.parse(data);
            if (parsed.usage && typeof parsed.usage === "object") usage = toUsage(parsed.usage);
            const choice = parsed.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};
            if (typeof delta.content === "string" && delta.content) {
              content += delta.content;
              text += delta.content;
              req.onText?.(delta.content);
            }
            for (const tc of delta.tool_calls ?? []) {
              const call = calls.get(tc.index ?? 0) ?? {
                id: "",
                type: "function" as const,
                function: { name: "", arguments: "" },
              };
              if (tc.id) call.id = tc.id;
              if (tc.function?.name) call.function.name += tc.function.name;
              if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
              calls.set(tc.index ?? 0, call);
            }
            if (choice.finish_reason) finish = choice.finish_reason;
          }
        } catch {
          throw new LlmError("The AI provider sent a response that couldn't be read.", "bad_response");
        }

        if (usage) req.onUsage?.(usage);

        if (calls.size === 0 || !req.runTool) {
          if (finish === "content_filter") throw new LlmError("The AI provider declined to answer that.", "declined");
          return text.trim();
        }
        const toolCalls = [...calls.values()];
        messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          let result: string;
          try {
            result = clip(await req.runTool(call.function.name, JSON.parse(call.function.arguments || "{}")));
          } catch (e) {
            result = `Error: ${e instanceof Error ? e.message : "tool failed"}`;
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
        if (text && !text.endsWith("\n")) {
          text += "\n\n";
          req.onText?.("\n\n");
        }
      }
      throw new LlmError("The AI provider needed too many steps to answer.", "bad_response");
    },
  };
}
