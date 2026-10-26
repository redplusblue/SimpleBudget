# Architecture

SimpleBudget is one Next.js app (UI and API together) plus one SQLite file. There is no separate backend, queue or cache.

## Stack
Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 + shadcn/ui (Radix) · TanStack Query / Virtual / Table ·
Recharts (some charts; the net-worth chart is a hand-written SVG) · SQLite via `better-sqlite3` + Drizzle ORM (migrations with drizzle-kit) ·
zod 4 · iron-session + argon2 (single-user login) · node-cron (schedulers) · pino (logging) · Vitest (unit) · Playwright (e2e).
Runs in Docker as a Next **standalone** build.

## Folder map
```
src/
  app/
    (auth)/login, setup           public pages
    (app)/…                       signed-in pages: dashboard, spending, accounts, transactions, insights,
                                  forecast, goals, year, rules, settings/*
    api/…                         route handlers (thin; see docs/API.md)
    manifest.ts, icons/, icon.svg, favicon.ico/  PWA + icons (drawn on request with next/og)
  components/                     UI by feature (dashboard, register, spending, accounts, goals, …); ui/ is shadcn
  db/                             schema.ts, open.ts (pragmas + SQL functions), client.ts (singleton), migrate.ts,
                                  seed-fake.ts (demo data)
  lib/
    finance/                      all money logic: spending, net worth, recurring, forecast, splits, targets, goals, …
    simplefin/                    client, parser, sync engine, limits (rate budget), scheduler
    rules/                        rules engine + store
    insights/                     deterministic insight generators
    llm/                          optional AI (OpenAI-compatible only)
    import/ export/ backup/ notify/
    auth/                         session, CSRF check
  middleware.ts                   auth gate + CSRF + HSTS
  instrumentation.ts              starts the sync and backup schedulers at boot
drizzle/                          generated SQL migrations (committed)
tests/ unit/ e2e/ helpers/ fixtures/
public/sw.js                      service worker (static assets only)
```

## Request flow
Browser → `middleware.ts` (session cookie check, CSRF origin check, public-route allow-list) → either a server component
(pages that pass `initialData` to a client component) or a route handler → `src/lib/*` → `getDb()` (SQLite).
Client components fetch with TanStack Query (`fetchJson` in `src/lib/fetch-json.ts`); query keys are plain arrays
(`["dashboard"]`, `["transactions", qs]`, `["goals"]`, …) and `useRefreshMoney()` / `useInvalidateTaxonomy()` invalidate the groups that must refetch after a change.

Server-rendered first paint: `(app)/page.tsx`, `spending/page.tsx` and `transactions/page.tsx` compute the first payload on the server
and pass it to the client component as `initialData`; the client takes over once it is stale. Below-the-fold cards use `LazyMount`
(renders children only near the viewport) and chart code loads through `next/dynamic`.

## Data model (`src/db/schema.ts`, migrations `drizzle/0000-0006`)
| Table | Purpose / notes |
| --- | --- |
| `settings` | key/value. Keys: `password_hash`, `setup_complete`, `access_url:<connId>` (encrypted), sync schedule, `ai:*` (key encrypted), `notify:*` (url/token encrypted), `fx:rates` (JSON) |
| `connections` | one SimpleFIN connection (the access URL itself is in `settings`, encrypted) |
| `accounts` | bank fields (imported) + user overlay (display name, type, hidden/closed, exclude from net worth, color); `is_manual`, `credit_limit_cents`, `low_balance_cents`, `currency` |
| `balance_snapshots` | one row per account per local day; the net-worth history |
| `transactions` | imported + overlay (`category_id`, `notes`, `payee_override`, `is_transfer`, `transfer_pair_id`, `is_excluded`, `is_reviewed`), `source` = `simplefin`/`import`/`manual`, `merchant_key` (trigger-maintained) |
| `transaction_splits` | parts of a split transaction (`category_id`, `amount_cents`, `notes`); sums to the parent; dropped automatically if the parent amount changes |
| `categories`, `tags`, `transaction_tags` | taxonomy (`categories.is_income`, `is_archived`, `sort_order`) |
| `rules` | categorization rules (conditions/actions as JSON, priority order) |
| `budgets` | spending **targets** (per category or tag; recurring or one month); DB triggers/indexes enforce one subject and uniqueness |
| `sync_runs` | history of syncs (status, requests used, errors); also the SimpleFIN daily request budget |
| `insights_cache` | the saved AI monthly summary per month |
| `ai_threads`, `ai_messages` | saved assistant conversations (with a rolling summary) |
| `ai_memories` | facts the owner wrote or approved, sent with every AI request |
| `ai_insights` | generated insight cards (batch, cited fact ids, link, pinned/dismissed) |
| `ai_proposals` | things the AI suggests (rule suggestions now), with status `pending`/`accepted`/`dismissed`/`no_match`/`stale`, payload and preview JSON |
| `ai_runs` | one row per model request: feature, model, trigger, tokens, cost (micro-USD), status |
| `holdings` | positions in investment accounts (from SimpleFIN, replaced per sync) |
| `goals` | savings goals tracked against one account |

Migrations are SQL files; `runMigrations` applies them on first `getDb()`. **Never edit an applied migration**, add a new one.

## Invariants (break these and numbers go wrong)
1. **Cents everywhere.** Parsing is string-based (`parseCents`); no floats touch amounts. Display only via `formatCents`/`<Money>`.
2. **Sign:** negative = outflow. Expenses are `amount < 0`, not transfer, not excluded, and not in an income category (`expenseCondition`). Income is `amount > 0`, not transfer, not excluded (`incomeCondition`). Credit-card payments are transfers (paired in `transfers.ts`), so a purchase counts once.
3. **Effective date:** `posted` for posted rows, `transacted_at ?? imported_at` for pending (`effectiveDateSql`). Local day/month use the server `TZ` (`dates.ts`).
4. **Splits:** parent `category_id` is NULL when split; category aggregates use `splitExpenseLines`/`splitSpendByCategory` for split parents and `noSplitsSql` for the rest. Choosing a single category clears a split; rules never overwrite one.
5. **merchant_key** = normalized payee (`payee.ts`), maintained by triggers calling `payee_key()`; use it to group/filter merchants.
6. **Idempotent sync:** transactions upsert on `(account_id, sf_txn_id)`; pending→posted is reconciled (`pending.ts`); imported/manual rows have synthetic ids (`import-…`, `manual-…`).
7. **Secrets** are AES-256-GCM encrypted with a key derived from `APP_SECRET` (HKDF). Losing `APP_SECRET` makes stored secrets unreadable.

## Subsystems
### Sync (`src/lib/simplefin/`)
`sync.ts` is the engine: plans windows (≤ 60 days each, newest first; first run backfills, later runs cover the last 14 days), takes a DB-backed lock, fetches via `client.ts`
(retries on 5xx/network only), parses (`parse.ts`, `schemas.ts` are loose about unknown fields), upserts accounts/transactions/holdings/balance snapshots, reconciles pending,
pairs transfers, applies rules to new rows, then calls `notifyAfterSync`. `limits.ts` enforces the SimpleFIN budget (20 requests/day, 15-minute manual cooldown). `scheduler.ts` runs it with node-cron (started from `instrumentation.ts`). Manual accounts are never touched (sync only handles accounts the bank returns).

### Finance (`src/lib/finance/`)
`spending.ts` (dashboard month numbers, category breakdown) and `spending-report.ts` (the Spending page; one pass over a year of expense rows) are the two aggregators; `networth.ts`, `accounts-overview.ts`, `recurring.ts` (subscription/bill detection: ≥3 charges, cadence weekly/biweekly/monthly/yearly, amounts ±10%), `forecast.ts`, `targets.ts`, `goals.ts`, `year.ts`, `reconcile.ts`, `manual.ts`, `splits.ts`, `holdings.ts`, `currency.ts`. Types shared with the browser live in `*-types.ts` (client-safe).

### Rules (`src/lib/rules/`)
Fields: description, payee, amount, account, direction. First matching rule wins per field; tags add. Fill-empty by default (overwrite is opt-in). Run on new imports and on demand with a dry-run preview.

### Insights (`src/lib/insights/`)
`generators.ts` has nine deterministic generators over a shared per-request data loader (`data.ts`); `getInsights` isolates failures and sorts warn → good → info. They run on the server only and are the only thing the AI layer may quote (allow-list by id prefix in `llm/context.ts`).

### AI (`src/lib/llm/`): see [`AI.md`](AI.md). OpenAI-compatible chat completions only.

### Import/export, backup, notify
`import/` parses CSV (Actual's export or any CSV), plans matches/inserts, commits (see [`MIGRATING-FROM-ACTUAL.md`](MIGRATING-FROM-ACTUAL.md)). `export/` writes CSV and SQLite copies. `backup/` runs nightly `VACUUM INTO` copies (newest 14 kept). `notify/` sends ntfy/webhook alerts after a sync.

### Security
Single user, argon2id password, iron-session cookie (`SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`), login rate limit, CSP without `unsafe-eval`, CSRF origin check in `middleware.ts`, secrets encrypted at rest, write-only secret endpoints, log redaction.

## Frontend patterns
- **Register** (`components/register/`): infinite query + `useWindowVirtualizer`; filters live in the URL (`transaction-params.ts`); edits are optimistic with rollback; j/k/Enter/c keyboard cursor; the category picker is a lightweight button until first used (a Radix Select per row was the main cost).
- **Dialogs** use `ResponsiveDialog` (dialog on desktop, drawer on mobile). Lists that reorder use `SortableList`.
- **Cards** are wrapped in `CardBoundary` (per-card error boundary) and use skeleton/empty/error states.
- **Privacy mode** blurs `[data-money]`/`[data-sensitive]` via an attribute on `<html>`; amounts must render through `<Money>` for that to work.
- **Charts**: `ChartTable` wraps a chart with a "View as table" switch.

## Feature map
| Feature | UI | Logic | Tests |
| --- | --- | --- | --- |
| Setup / login | `app/(auth)`, `connect-simplefin-form.tsx` | `lib/setup.ts`, `lib/auth/` | `auth.spec`, `fresh.spec`, `setup.test` |
| Dashboard | `components/dashboard/` | `finance/dashboard.ts` | `dashboard.spec`, `spending.test` |
| Accounts, manual accounts, reconcile, holdings | `app/(app)/accounts`, `components/accounts/` | `accounts-overview.ts`, `manual.ts`, `reconcile.ts`, `holdings.ts` | `manual.spec`, `reconcile.spec`, `manual.test`, `holdings.test` |
| Register, splits | `components/register/` | `transactions-query.ts`, `transactions-update.ts`, `splits.ts` | `register.spec`, `splits.spec`, `splits.test` |
| Spending | `components/spending/` | `spending-report.ts`, `recurring.ts` | `spending.spec`, `spending-report.test` |
| Categories, tags, rules | `settings/categories`, `rules/` | `taxonomy-admin.ts`, `rules/` | `taxonomy.spec`, `rules.spec` |
| Targets | `components/targets/` | `targets.ts` | `targets.spec`, `targets.test` |
| Insights | `components/insights/` | `insights/` | `insights.spec`, `insights.test` |
| AI | `components/ai/`, `settings/ai` | `llm/` | `ai.spec`, `llm.test` |
| Forecast, goals, year | `components/forecast|goals|year/` | `forecast.ts`, `goals.ts`, `year.ts` | `phase12.spec`, matching unit tests |
| Currency, alerts | `components/currency|notify/` | `currency.ts`, `notify/` | `phase12.spec`, `currency.test`, `notify.test` |
| Import/export | `components/import/`, `settings/data` | `import/`, `export/` | `import.spec`, `import-*.test`, `export.test` |
| PWA, privacy, shortcuts, hardening | `shell/`, `manifest.ts` | `middleware.ts`, `logger.ts`, `backup/` | `polish.spec`, `console.spec`, `hardening.test` |
