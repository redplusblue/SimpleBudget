# AI features (optional)

Off by default. The app works the same without them; every failure of the AI path degrades to the normal insights.

## What it does
- **Monthly summary** on the Insights page: 5-8 bullets and 2-3 suggestions for this month, saved until your next sync (`insights_cache`).
- **Ask about your spending**: a chat box. The model sees a compact summary and may call read-only tools (all return formatted, aggregated answers; defined in `src/lib/llm/tools.ts`, computed in `src/lib/llm/analysis.ts`):

  | Tool | Answers |
  | --- | --- |
  | `get_period_report(month \| from+to)` | totals, savings rate, categories vs the previous period, top merchants, weekday pattern |
  | `get_monthly_trend(end_month)` | 12 months of spending/income/net and category-by-month |
  | `get_year_summary(year)` | a year in review: risers, fallers, top merchants, recurring cost |
  | `get_recurring()` | subscriptions and bills, price increases, probably-cancelled |
  | `get_merchant_history(query)` | one merchant's cost month by month |
  | `get_category_totals(month)` | category totals with the previous month |
  | `search_transactions(query, from?, to?)` | ≤ 50 rows of date, normalized payee, amount, category |

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

## Choosing models
Three layers (Settings → AI):
1. **The model list** ("Models you allow"): a JSON array of `{ "id", "label"?, "inputPerMTok"?, "outputPerMTok"? }` (or plain strings). All models share the one server address and key. Empty = just the "Default model".
2. **A default model per feature** (`rules`, `chat`, `insights`, `trace`, `automations`, `search`, `web`); unset falls back to the default model.
3. **A per-request choice**: buttons with a model dropdown (Monthly summary, Ask) preselect the feature default; changing it affects only that request. The server rejects any model not in the list (400).

## Costs and the monthly budget
Every model request from the app or `pnpm ai:categorize` writes one row to `ai_runs` (feature, model, trigger, tokens, cost, status; never prompt text). Cost is the provider's figure when it reports one (OpenRouter's `usage.cost`), otherwise estimated from the list's `inputPerMTok`/`outputPerMTok`, otherwise unknown. Costs are stored as integer micro-USD. The client asks for usage with `stream_options.include_usage`; a server that rejects that parameter is retried once without it. Set a **monthly budget** (USD) and every request is refused once the month's recorded cost reaches it; `0` pauses all AI, empty means no cap. Settings → AI shows this month's spend, per-feature totals and the last 20 runs.

## Where the code is
| File | Role |
| --- | --- |
| `src/lib/llm/types.ts` | `LlmClient.generate({system, user, history?, tools?, runTool?, onText?})`, `LlmError` |
| `src/lib/llm/openai-compatible.ts` | the only client: SSE streaming, tool loop (≤ 6 rounds), error mapping, `max_tokens` fallback, tool-less retry |
| `src/lib/llm/config.ts` | settings (`ai:*`), encrypted key, validation, `modelFor` / `isAllowedModel` |
| `src/lib/llm/models.ts` | client-safe: `AiFeature`s, model-list schema and parser |
| `src/lib/llm/runs.ts` | `trackRuns` (writes `ai_runs`), monthly spend, budget check, usage report |
| `src/lib/llm/context.ts` | the allow-listed data the model may see |
| `src/lib/llm/tools.ts` | the tools |
| `src/lib/llm/analysis.ts` | the compact reports the tools, MCP server and export share |
| `src/lib/llm/categorize.ts`, `src/db/ai-categorize.ts` | the bulk categorize job |
| `src/lib/llm/export.ts`, `src/db/ai-export.ts` | the markdown snapshot |
| `src/lib/mcp/server.ts`, `src/db/mcp-server.ts` | the MCP server |
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

## Bulk categorizing (manual, pay-per-run)
`pnpm ai:categorize` asks your configured model to categorize transactions that have **no category** (rules run first at sync time, so this only handles what they missed). It never runs on its own, which is the cost control: nothing happens unless you type the command.

How it keeps the bill small:
- It works **per distinct payee**, not per transaction: 4,000 uncategorized rows from 26 merchants is a single call. Biggest merchants first.
- Defaults cap a run at 200 payees, 40 per call, 5 calls (`--max-payees`, `--batch-size`, `--max-calls`). Whatever is left waits for the next run.
- It prints the plan (payees, calls, estimated input tokens, model, server) and asks `Continue? [y/N]` before sending anything (`--yes` skips the prompt).
- `--model cheap/model-name` overrides the model for this run only; a small model is plenty for this.

```bash
pnpm ai:categorize                      # 1. ask the model; saves ./data/ai-categorize-proposals.json; changes nothing
pnpm ai:categorize --from data/ai-categorize-proposals.json --apply --make-rules   # 2. write them, no second charge
pnpm ai:categorize --apply              # or ask and write in one go
```
- Only answers at or above `--min-confidence` (default `high`; `medium`, `low` also accepted) are written. Model answers naming a category you don't have are dropped, never invented.
- Only **empty** categories are filled; anything you categorized (or split) since the preview is left alone. Transfers and excluded rows are never touched.
- `--make-rules` also creates a rule per merchant (*payee is X and direction is Y → category*, named `AI: X`), so future syncs categorize that merchant for free and you can edit or delete the rule on the Rules page.
- Uses the server address, model and key from **Settings → AI** (the "Turn on AI features" switch is not required for this job). Needs `APP_SECRET` and `DATABASE_PATH` set as for the app.
- Sent to the model: cleaned payee name, one raw bank description for that payee, typical amount, how many, direction, and your category names. Never account ids, notes or memos.

## Making insights easy for any LLM
Three ways to put your numbers in front of a model, from cheapest to most convenient:

1. **`pnpm -s ai:export --out snapshot.md`**: one markdown file (~5k tokens) with this month, a full period report, the 12-month trend, subscriptions and this/last year in review, plus a short analyst prompt. Calls no model; paste or attach it to any chat assistant. Options: `--month YYYY-MM`, `--include-balances`.
2. **The in-app assistant** (above): the model pulls only what it needs through the tools.
3. **MCP server** for Claude Desktop / Claude Code (below).

### Ask from Claude Desktop or Claude Code (MCP)
`pnpm mcp` is a local, **read-only** [MCP](https://modelcontextprotocol.io) server on stdio exposing `get_overview` plus all the tools above. It opens the database read-only, so it cannot change your budget, and it needs no `APP_SECRET`.

Claude Code: `claude mcp add simplebudget -e DATABASE_PATH=/path/to/simplebudget.db -e TZ=America/New_York -- pnpm --dir /path/to/SimpleBudget exec tsx --conditions=react-server src/db/mcp-server.ts`

Claude Desktop (`claude_desktop_config.json`):
```json
{ "mcpServers": { "simplebudget": {
  "command": "pnpm",
  "args": ["--dir", "/path/to/SimpleBudget", "exec", "tsx", "--conditions=react-server", "src/db/mcp-server.ts"],
  "env": { "DATABASE_PATH": "/path/to/simplebudget.db", "TZ": "America/New_York" }
} } }
```
Add `--include-balances` to the args to let it see account names and balances (off by default, like the in-app opt-in). Remember that whatever the tools return is sent to the model behind that client; the same aggregate-only rules as above apply. Use the demo database (`pnpm db:seed-fake --setup`) to try it first.
