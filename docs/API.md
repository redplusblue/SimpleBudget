# HTTP API

All endpoints live under `src/app/api/**/route.ts`, return JSON unless noted, and need a signed-in session cookie (`sb_session`) except the **public** ones.
Without a session an API call returns `401 {"error":"unauthorized"}`; a mutating request that looks cross-site returns `403` (CSRF origin check in `middleware.ts`).
Errors are `{ "error": "<code>", "message": "<safe text>" }` with 400 (invalid), 404 (not found), 409 (conflict/disabled), 502 (AI provider problem); the mapping is `src/lib/api-errors.ts`.
Handlers are thin: logic and zod validation are in `src/lib/...`; read the matching lib file for exact payloads. Several GETs add a `Server-Timing` header.

**Public:** `GET /api/health`, `POST /api/auth/login`, `POST /api/setup/password` (only works while no password exists).

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/about` | Version, database size and the backups on disk. |
| POST | `/api/about/backup` | "Back up now": writes a backup into the backups folder (the nightly job does the same). |
| GET | `/api/accounts` | All accounts (raw rows), used by pickers. |
| POST | `/api/accounts` | Creates an offline (manual) account: `{ name, type?, balanceCents? }`. |
| DELETE | `/api/accounts/[id]` | Deletes a manual account and its transactions. Accounts synced from a bank are removed with their connection instead. |
| GET | `/api/accounts/[id]` | One account with this month's stats and a 90-day balance series. |
| PATCH | `/api/accounts/[id]` | Edit user-overlay fields only (display name, type, hidden/closed, exclude from net worth, color, credit limit, low-balance alert). Bank fields are read-only. |
| PUT | `/api/accounts/[id]/balance` | Sets what a manual account holds right now. |
| GET | `/api/accounts/[id]/holdings` | The positions SimpleFIN reports for an investment account (empty list when the bank sends none). |
| POST | `/api/accounts/[id]/reconcile` | `{ date, balanceCents, markReviewed? }`: compares the statement balance with what the app's records add up to. |
| POST | `/api/accounts/[id]/transactions` | Adds a transaction to a manual account: `{ date, amountCents, description, categoryId?, notes? }`. |
| GET | `/api/accounts/overview` | Accounts grouped for the Accounts page (cash, credit, investments, loans, other, closed) with group totals converted at your currency rates and 30-day sparklines. |
| POST | `/api/auth/login` | `{ password }` → sets the session cookie. Rate limited. **Public.** |
| POST | `/api/auth/logout` | Clears the session cookie. |
| GET | `/api/categories` | All categories (archived ones flagged), for pickers and for naming the category a row is filed under. |
| POST | `/api/categories` | `{ name, color, icon?, groupName?, isIncome? }` creates a category (names are unique, case-insensitive). |
| DELETE | `/api/categories/[id]` | Delete; its transactions become uncategorized and rules stop referencing it. |
| PATCH | `/api/categories/[id]` | Rename, recolor, set icon/group, mark income, archive/restore. |
| POST | `/api/categories/[id]/merge` | Moves all of this category's transactions into another category and deletes this one. |
| GET | `/api/categories/admin` | Categories with how many transactions use each, for the settings page. |
| PUT | `/api/categories/order` | `{ ids }` saves the display order (tolerates stale lists). |
| GET | `/api/connections` | The connections (never the access URL). |
| POST | `/api/connections` | `{ setupToken }` claims a SimpleFIN setup token and stores the access URL encrypted. |
| DELETE | `/api/connections/[id]` | Removes a SimpleFIN connection with its accounts and transactions (and rules that referenced them). |
| GET | `/api/dashboard` | Everything the home page shows, for the current month or `?month=YYYY-MM`. |
| GET | `/api/dashboard/upcoming` | The dashboard's "Upcoming" card: next recurring charges and the monthly total. |
| GET | `/api/export/backup` | A SQLite backup of everything, as a download. |
| GET | `/api/export/transactions` | Every transaction as a CSV download. |
| GET | `/api/forecast` | A 30-day cash-flow projection from recurring bills and income. |
| GET | `/api/goals` | Every goal with progress, needed-per-month and projected finish date. |
| POST | `/api/goals` | `{ name, accountId, targetCents, startCents?, targetDate? }` |
| DELETE | `/api/goals/[id]` | Remove a goal. |
| PUT | `/api/goals/[id]` | Replace a goal (same body as create). |
| GET | `/api/health` | `{ ok: true }` for health checks. **Public.** |
| POST | `/api/import/commit` | Imports the file as previewed. Safe to repeat: rows already present are matched, not added again. |
| POST | `/api/import/preview` | What importing this file would do (nothing is written). |
| GET | `/api/insights` | Every deterministic insight for the current month, most important first. Works with AI switched off. |
| POST | `/api/insights/ask` | "Ask about your spending": answers from aggregates plus read-only lookup tools. |
| GET | `/api/insights/summary` | The saved monthly summary, if any (and whether AI is on at all). |
| POST | `/api/insights/summary` | Generates a fresh summary and streams it as newline-delimited JSON: {"type":"text","text":"..."} pieces, then {"type":"done","createdAt":...} or {"type":"error","message":"..."}. / |
| GET | `/api/networth` | Net worth summary plus the daily series for `?range=1M|3M|6M|1Y|ALL`. |
| GET | `/api/recurring` | Detected subscriptions and regular bills, with their next expected dates and monthly cost. |
| GET | `/api/rules` | All rules in priority order. |
| POST | `/api/rules` | Create a rule `{ name, conditions[], actions{}, enabled }`. |
| DELETE | `/api/rules/[id]` | Delete a rule. |
| PATCH | `/api/rules/[id]` | Toggles a rule on or off: `{ enabled: boolean }`. |
| PUT | `/api/rules/[id]` | Replaces a rule's definition. |
| POST | `/api/rules/apply` | Runs one rule (`ruleId`) or every enabled rule over existing transactions. By default only empty fields are filled; `overwrite: true` lets rules replace values that are already set. `dryRun: true` only reports how many transactions would change. / |
| PUT | `/api/rules/order` | Sets rule priority: the first id runs first. |
| POST | `/api/rules/preview` | "Matches N existing transactions" for a rule that may not be saved yet. Nothing is changed. |
| GET | `/api/settings/ai` | The AI settings. The API key is write-only: responses say whether one is saved, never what it is. |
| PUT | `/api/settings/ai` | Update AI settings: `{ enabled?, baseUrl?, model?, includeBalances?, apiKey? (string saves, null removes), models? (parsed `[{id,label?,inputPerMTok?,outputPerMTok?}]`, null clears), featureModels? (`{ feature: modelId }`, null clears), monthlyBudgetMicros? (null = no cap, 0 = pause AI) }`. Feature defaults and the default model must be in the model list. Turning on needs a server address and a model. |
| GET | `/api/ai/usage` | This month's AI spend vs budget, per-feature totals and the last 20 runs (no prompt text). |
| GET / POST | `/api/ai/insights` | `GET ?limit=` saved cards (pinned first, dismissed hidden). `POST { lens?, model?, count? }` generates a batch from computed facts (no facts = no model call; budget-checked). |
| PATCH | `/api/ai/insights/[id]` | `{ pinned?, dismissed? }`. |
| GET / POST | `/api/ai/memories` | List / add a memory `{ text }` (3-300 chars, max 50). Sent with every AI request. |
| PATCH / DELETE | `/api/ai/memories/[id]` | `{ text?, enabled? }` / remove. |
| POST | `/api/ai/chat` | `{ threadId?, lens, text, model? }` streams NDJSON events: `thread`, `text`, `proposal`, then `done` or `error`. |
| GET | `/api/ai/threads` | Conversations, newest first (max 100). |
| GET / PATCH / DELETE | `/api/ai/threads/[id]` | Messages plus the proposals made in the thread / `{ title }` / delete. |
| GET | `/api/ai/proposals` | `?kind=rule&status=pending` (defaults; `status=dismissed` also returns `no_match`). `{ proposals }` with fresh previews; `stillValid: false` + `problem` when the category/tag is gone. |
| POST | `/api/ai/proposals/[id]/accept` | Applies a proposal by kind. Rules: `{ categoryId?, applyExisting? (default true) }` creates or extends the rule, optionally categorizing existing empty matches (`{ kind, ruleId, ruleName, mode, categorized }`). Memories: `{ kind, memoryId }`. Targets: `{ kind, targetId }`. 409 if already handled. |
| POST | `/api/ai/proposals/[id]/dismiss` | Dismisses a pending suggestion. |
| DELETE | `/api/ai/proposals/[id]` | Forgets a dismissed/no_match suggestion so the merchant can be asked again. |
| POST | `/api/ai/proposals/accept-all` | `{ minConfidence: "high"\|"medium", applyExisting? }` accepts non-conflicting pending suggestions. `{ accepted, skipped, categorized }`. |
| GET | `/api/ai/rule-suggestions/plan` | `?model=` optional. What a run would do (eligible merchants, requests, tokens, cost when prices are known). Free. |
| POST | `/api/ai/rule-suggestions/run` | `{ model? }` asks the model and stores suggestions. 409 `ai_disabled` / `busy`; refused over budget. `{ created, noMatch, unanswered, calls, deferred }`. |
| GET / PUT | `/api/settings/ai/rules` | Suggestion schedule: `{ schedule: manual\|after_sync\|interval, intervalDays, minNewMerchants, maxMerchantsPerRun, suggestTags }` plus read-only `lastRunAt`. |
| POST | `/api/settings/ai/test` | Sends a tiny fixed prompt (no financial data) to check the key, model and URL. |
| GET | `/api/settings/currency` | The non-dollar currencies your accounts use, and the rate saved for each. |
| PUT | `/api/settings/currency` | `{ rates: { EUR: 1.0856 } }`: 1 unit of the currency in US dollars. |
| GET | `/api/settings/notifications` | Notification settings. The address and token are write-only: responses only say whether they exist (and the host). |
| PUT | `/api/settings/notifications` | Update alert settings: `{ enabled?, kind?, url? , token?, largeCents?, onLarge?, onFailure?, details? }` (url/token: string saves, null removes). |
| POST | `/api/settings/notifications/test` | Sends a harmless test message to the saved destination. |
| POST | `/api/setup/complete` | Finishes the setup wizard. |
| POST | `/api/setup/password` | First-run only: public, but refuses once a password exists. |
| GET | `/api/spending` | Spending analytics for `?month=YYYY-MM` (default: the current month) or a custom `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, at most 366 days). / |
| POST | `/api/sync` | Starts a sync in the background and returns immediately; poll /api/sync/status for progress. |
| GET | `/api/sync/runs` | Recent sync history. |
| PUT | `/api/sync/schedule` | `{ schedule }` sets how often the background sync runs (off, 3h, 6h, 12h, 24h). |
| GET | `/api/sync/status` | Current sync state: running + progress, last success, requests used today, cooldown. |
| GET | `/api/tags` | All tags, for pickers. |
| POST | `/api/tags` | Creates a tag, or returns the existing one with the same name. |
| DELETE | `/api/tags/[id]` | Delete a tag (removed from transactions and rules). |
| PATCH | `/api/tags/[id]` | Rename or recolor a tag. |
| GET | `/api/tags/admin` | Tags with usage counts. |
| GET | `/api/targets` | All targets. |
| POST | `/api/targets` | `{ kind: "category" | "tag", subjectId, amountCents, month?: "YYYY-MM" }` (no month = every month). |
| DELETE | `/api/targets/[id]` | Remove a target. |
| PATCH | `/api/targets/[id]` | Change a target's amount or month. |
| GET | `/api/transactions` | Paged register query. Filters: `account, q, from, to, category, tag, min, max, type, status, merchant`; `cursor`, `limit` (≤ 200). |
| PATCH | `/api/transactions` | Bulk edit: { ids, patch }. |
| GET | `/api/transactions/[id]` | One transaction with raw bank data, tags, transfer partner and local date. |
| PATCH | `/api/transactions/[id]` | Edit overlay fields: category, notes, payee override, excluded, reviewed, transfer flag, tags. Choosing a category clears a split. |
| DELETE | `/api/transactions/[id]/manual` | Delete a transaction you added by hand (restores the account balance). |
| PATCH | `/api/transactions/[id]/manual` | Edits the core fields (date, amount, description) of a transaction you added by hand. |
| GET | `/api/transactions/[id]/splits` | The parts of a split transaction. |
| PUT | `/api/transactions/[id]/splits` | `{ parts: [{ categoryId, amountCents, notes? }] }`; parts must add up to the amount. An empty list removes the split. |
| GET | `/api/year` | `?year=2025` (default: this year). |

## Adding an endpoint
1. Create `src/app/api/<name>/route.ts`; begin with `const denied = await requireApiAuth(); if (denied) return denied;`.
2. Put logic and zod validation in `src/lib/...`; map domain errors with `errorResponse` (add your error class to `api-errors.ts`).
3. Add the path to `tests/unit/middleware.test.ts` (asserts 401 without a session).
4. Add a row to the table above.
