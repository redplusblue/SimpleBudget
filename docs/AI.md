# AI features (optional)

Off by default. The app works the same without them; every failure of the AI path degrades to the normal insights.

## What it does
- **Monthly summary** on the Insights page: 5-8 bullets and 2-3 suggestions for this month, saved until your next sync (`insights_cache`).
- **Ask about your spending**: a chat box. The model sees a compact summary and may call two read-only tools:
  `get_category_totals(month)` and `search_transactions(query, from?, to?)` (≤ 50 rows of date, normalized payee, amount, category).

## Which servers work
**Anything that speaks the OpenAI chat-completions protocol** (`POST {baseUrl}/chat/completions`, server-sent-event streaming, optional tool calls). That is all the app supports: there is no vendor SDK.

| Server | Server address | API key | Model name |
| --- | --- | --- | --- |
| **OpenRouter** | `https://openrouter.ai/api/v1` (prefilled) | create at openrouter.ai → Keys (`sk-or-…`) | OpenRouter slug, e.g. `anthropic/claude-sonnet-4.5`, `openai/gpt-4o-mini`, `google/gemini-2.0-flash-001`, `meta-llama/llama-3.3-70b-instruct` |
| **Open WebUI** | `http://<host>:<port>/api` (e.g. `http://openwebui:3000/api`) | Open WebUI → Settings → Account → API keys | the model id Open WebUI lists (e.g. `llama3.1:latest`) |
| Ollama | `http://localhost:11434/v1` | none | e.g. `llama3.1` |
| OpenAI | `https://api.openai.com/v1` | `sk-…` | e.g. `gpt-4o-mini` |

The server address is the part *before* `/chat/completions`. If SimpleBudget runs in Docker and the AI server on the host, use `http://host.docker.internal:<port>/…` (add `extra_hosts: ["host.docker.internal:host-gateway"]` to the compose service on Linux) or put both on one Docker network and use the container name.

## Set it up (OpenRouter or Open WebUI)
1. **Settings → AI**.
2. Server address: leave the OpenRouter default or enter your Open WebUI address.
3. Model: required. Paste the model id.
4. API key: paste it (stored encrypted, never shown again; leave empty only if your server needs none).
5. Turn on **Turn on AI features** and **Save**, then **Test connection** (sends a tiny fixed prompt with no financial data).
6. Open **Insights**: *Write summary* and the question box appear.

Tool use needs a model that supports function calling. If the server rejects the `tools` parameter, SimpleBudget retries without it and answers from the summary alone.
Models that insist on `max_completion_tokens` (newer OpenAI models) are handled automatically.

## Privacy: exactly what leaves your server
Assembled in `src/lib/llm/context.ts` from aggregates only:
- category totals (this month, last month, 3-month average), top merchants (name, total, count), month totals,
- the deterministic insights whose ids are on an **allow-list** (spending patterns, price increases, duplicates, …).
Never sent: account numbers/ids, the SimpleFIN access URL, raw bank descriptions, memos, notes, your API key.
**Opt-in** (checkbox "Also share account names and balances"): account names, balances, and the low-balance / credit-utilization insights.
Question tools return normalized payee, date, amount, category for ≤ 50 rows. In development (`NODE_ENV=development`) the exact outgoing payload is logged to the server console; tests assert that no account id or access URL appears in a request.
Remember that with a hosted server (OpenRouter and the model vendor behind it) this aggregated data does leave your network; use a local server (Open WebUI with a local model) if that matters.

## Where the code is
| File | Role |
| --- | --- |
| `src/lib/llm/types.ts` | `LlmClient.generate({system, user, history?, tools?, runTool?, onText?})`, `LlmError` |
| `src/lib/llm/openai-compatible.ts` | the only client: SSE streaming, tool loop (≤ 6 rounds), error mapping, `max_tokens` fallback, tool-less retry |
| `src/lib/llm/config.ts` | settings (`ai:*`), encrypted key, validation |
| `src/lib/llm/context.ts` | the allow-listed data the model may see |
| `src/lib/llm/tools.ts` | the two tools |
| `src/lib/llm/narrative.ts` | prompts, summary cache (stale after a later sync), question answering |
| `src/app/api/settings/ai*`, `src/app/api/insights/{summary,ask}` | HTTP |
| `src/components/ai/` | settings panel, Insights panel, tiny markdown renderer |
| tests | `tests/unit/llm.test.ts` (fake clients + mocked `fetch`), `tests/e2e/ai.spec.ts` (mock OpenAI-compatible server) |

## Troubleshooting
| Message | Meaning |
| --- | --- |
| "The AI provider rejected the API key." | 401/403: wrong or expired key |
| "…doesn't know that model or URL." | 404: wrong model id or server address (remember the address excludes `/chat/completions`) |
| "…rate limiting requests." | 429: slow down or change model |
| "Couldn't reach the AI provider." | DNS/connection: check the address from *inside* the container |
| 400 with `Unsupported parameter` | a server quirk not yet handled; look at the server's error body and extend `openai-compatible.ts` (add a test) |
