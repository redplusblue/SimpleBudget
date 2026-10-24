# SimpleBudget — Implementation Plan

A self-hosted, single-user personal finance dashboard that pulls data from **SimpleFIN Bridge**. It stays close to the source data: no envelope budgeting, no forced categories. It should look polished, work well on mobile, and be stable enough to replace Actual Budget for a non-power user.

> **For the implementing agent:** Do the phases in order. Each phase ends with **Acceptance criteria**. Don't start the next phase until every box is checked and `pnpm lint && pnpm typecheck && pnpm test` pass. Commit at the end of each phase with the message `Phase N: <title>`. If something is ambiguous, pick the simplest option that satisfies the acceptance criteria and add it to `DECISIONS.md`.

---

## 0. Guiding principles

1. **Source data is truth.** Never mutate imported fields (amount, posted date, description, payee). User edits (category, tags, notes, display name, hidden flag) go in separate columns or tables, so a re-sync never overwrites them and the original is always visible.
2. **Unopinionated.** Categories and tags are optional. The app must be useful with zero setup. Budgets (Phase 8) are optional "spending targets", not envelopes.
3. **Stable.** One process, one SQLite file, one Docker container. No external services are required except SimpleFIN. The LLM is optional.
4. **Mobile-first.** Design every screen at 390px width first, then scale up. Installable as a PWA.
5. **Sleek.** Dark-first theme with a good light theme, one consistent color system, smooth but restrained motion, tabular numbers everywhere.

---

## 1. Tech stack (fixed — do not substitute)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript (strict)** | One codebase for UI and API, large ecosystem |
| Package manager | **pnpm** | |
| DB | **SQLite** via **better-sqlite3** + **Drizzle ORM** (+ drizzle-kit migrations) | Single file, trivial backups |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) | Polished, accessible components |
| Charts | **Recharts** (+ hand-rolled SVG sparklines) | Simple and good enough |
| Icons | **lucide-react** | |
| Animation | **framer-motion** (sparingly) | |
| Data fetching (client) | **TanStack Query** | Caching, refetch after sync |
| Tables | **TanStack Table** + **@tanstack/react-virtual** | Large transaction lists |
| Validation | **zod** | All API inputs and SimpleFIN responses |
| Dates | **date-fns** | |
| Money | Store as **integer cents** (`INTEGER`). Never use floats for math. | |
| Scheduling | **node-cron**, started in `instrumentation.ts` | Background sync |
| Auth | Single-user password (argon2 hash) + signed HTTP-only session cookie (`iron-session`) | |
| Secrets at rest | AES-256-GCM using `APP_SECRET` env var (for the SimpleFIN access URL and LLM API key) | |
| Tests | **Vitest** (unit), **Playwright** (a few e2e smoke tests) | |
| Lint/format | ESLint (next config) + Prettier | |
| Deploy | **Dockerfile** (multi-stage, `output: "standalone"`) + `docker-compose.yml` with a volume at `/data` | |
| PWA | `manifest.webmanifest` + minimal service worker (cache app shell only, never financial data) | |

---

## 2. SimpleFIN reference (read carefully)

Protocol docs: https://www.simplefin.org/protocol.html

**Setup flow**
1. The user pastes a **Setup Token** (base64 string) from https://bridge.simplefin.org.
2. Base64-decode it to get a **Claim URL**.
3. `POST` to the Claim URL with an empty body. The response body (text) is the **Access URL**, shaped like `https://user:pass@host/simplefin`. **The token can be claimed only once.** If the POST returns 403, the token was already claimed or is invalid. Show a clear error.
4. Encrypt the Access URL and store it. Never log it and never send it to the client.

**Fetching data**
- `GET {accessUrl}/accounts?start-date=<unix>&end-date=<unix>&pending=1`, using HTTP Basic auth parsed from the URL's userinfo. (Strip the credentials out of the URL and send them in an `Authorization` header instead, because `fetch` rejects URLs that contain credentials.)
- Optional `balances-only=1` (returns no transactions) is cheap and useful for a quick refresh.
- Optional `account=<id>` (can repeat) filters by account.
- Response shape (validate it with zod and allow unknown keys):
  ```ts
  {
    errors: string[],                 // show these to the user (e.g. "re-authenticate bank X")
    accounts: Array<{
      org: { domain?: string, name?: string, "sfin-url": string, url?: string, id?: string },
      id: string,
      name: string,
      currency: string,               // usually "USD"; may be a URL for custom currencies
      balance: string,                // decimal string, e.g. "-1234.56"
      "available-balance"?: string,
      "balance-date": number,         // unix seconds
      transactions?: Array<{
        id: string,                   // unique per account, not globally
        posted: number,               // unix seconds; 0 if pending
        amount: string,               // decimal string; negative = money out
        description: string,
        payee?: string,
        memo?: string,
        transacted_at?: number,
        pending?: boolean,
        extra?: object
      }>,
      holdings?: unknown[],
      extra?: object
    }>
  }
  ```
- **Constraints:** Requests are limited to about **90 days** of range each, and the Bridge allows about **24 requests/day**. The sync engine must:
  - Split backfills into ≤ 60-day windows.
  - Run incremental syncs over the last **14 days** (to catch pending→posted changes and late posts).
  - Default schedule: every 6 hours, plus a manual "Sync now" button limited to once per 15 minutes.
  - Track a request counter per UTC day in the DB and refuse to go over 20/day.
- **Sign convention:** SimpleFIN uses negative = outflow for both bank and credit card accounts. Credit card balances come back negative when you owe money. Keep this convention internally. Net worth = sum of balances.
- Parse decimal strings into cents with string math (`"12.3"` → 1230). Do **not** use `parseFloat * 100`. Write a unit test for it.

**Pending transactions:** Their ids can change when they post. Rules:
- Upsert by `(account_id, sf_txn_id)`.
- After each sync window, delete any `pending = 1` rows for that account inside the synced window that weren't in the response. If those rows had user edits (category/tags/notes), try to move the edits to a newly posted txn with the same amount within ±5 days whose description is similar (normalized prefix match). Otherwise drop them.

---

## 3. Data model (Drizzle schema, `src/db/schema.ts`)

```
settings            (key TEXT PK, value TEXT)          -- password hash, encrypted access url, llm config, theme, etc.
connections         (id, org_name, org_domain, sfin_url, created_at, last_error TEXT NULL)
accounts            (id TEXT PK  -- the SimpleFIN account id
                     connection_id, org_name, name, currency,
                     balance_cents INT, available_cents INT NULL, balance_date INT,
                     -- user overlay:
                     display_name TEXT NULL, type TEXT  -- 'checking'|'savings'|'credit'|'investment'|'loan'|'cash'|'other' (guess from name; user can override)
                     is_hidden INT DEFAULT 0, is_closed INT DEFAULT 0, exclude_from_net_worth INT DEFAULT 0,
                     color TEXT NULL, sort_order INT, created_at, updated_at)
balance_snapshots   (account_id, date TEXT 'YYYY-MM-DD', balance_cents)  PK(account_id, date)
                     -- write one per account per day on sync; this powers the net worth history
transactions        (id INTEGER PK AUTOINCREMENT,
                     account_id, sf_txn_id, posted INT, transacted_at INT NULL, pending INT,
                     amount_cents INT, description TEXT, payee TEXT NULL, memo TEXT NULL, raw_json TEXT,
                     -- user overlay:
                     category_id INT NULL, notes TEXT NULL, payee_override TEXT NULL,
                     is_transfer INT DEFAULT 0, transfer_pair_id INT NULL,
                     is_excluded INT DEFAULT 0,   -- hide from stats (e.g. reimbursed)
                     is_reviewed INT DEFAULT 0,
                     imported_at, updated_at,
                     UNIQUE(account_id, sf_txn_id))
                     INDEXES: (posted), (account_id, posted), (category_id)
categories          (id, name, group_name TEXT NULL, color, icon, is_income INT, sort_order, is_archived)
tags                (id, name UNIQUE, color)
transaction_tags    (transaction_id, tag_id) PK both
rules               (id, name, priority INT, enabled INT,
                     conditions_json  -- [{field:'description'|'payee'|'amount'|'account', op:'contains'|'equals'|'regex'|'gt'|'lt'|'between', value}]
                     match TEXT 'all'|'any',
                     actions_json     -- {category_id?, add_tags?: number[], payee_override?, mark_transfer?, exclude?}
                     created_at)
budgets             (id, category_id NULL, tag_id NULL, month TEXT NULL  -- NULL = recurring every month
                     amount_cents)                      -- Phase 8, optional
sync_runs           (id, started_at, finished_at, status 'ok'|'partial'|'error', requests_used INT,
                     accounts_updated INT, txns_added INT, txns_updated INT, errors_json TEXT)
insights_cache      (id, month TEXT, kind TEXT, payload_json, created_at)
```

Seed a default set of ~15 categories (Groceries, Dining, Transport, Shopping, Bills & Utilities, Rent/Mortgage, Subscriptions, Health, Travel, Entertainment, Income, Transfer, Fees, Gifts, Other), each with a palette color. The user can delete all of them.

**Derived concepts (implement as SQL/TS helpers in `src/lib/finance/`):**
- `isExpense(txn)` = `amount < 0 && !is_transfer && !is_excluded && category is not income`.
- `isIncome(txn)` = `amount > 0 && !is_transfer && !is_excluded`.
- Credit card payments count as transfers, not expenses. That way purchases on the card are counted once, when they happen.
- "Month" uses the user's timezone setting (default: the server TZ), based on `posted` (or `transacted_at` when pending).

---

## 4. Design system (implement in Phase 1, use everywhere)

**Feel:** Linear / Copilot Money / Arc. Dark-first, deep neutral background, soft elevated cards, one vivid accent, colored data.

- **Tokens** (CSS variables in `globals.css`, light and dark):
  - `--bg` (dark: `#0B0D12`, light: `#F7F8FA`), `--surface` (dark `#12151C`), `--surface-2` (dark `#191D26`), `--border` (dark `#232836`), `--text`, `--text-muted`, `--text-faint`.
  - `--accent`: an indigo-to-violet gradient (`#6366F1` → `#8B5CF6`) for primary actions and hero numbers.
  - Semantic: `--positive` `#22C55E` (income/up), `--negative` `#F43F5E` (expense/down), `--warning` `#F59E0B`, `--info` `#38BDF8`.
  - **Categorical chart palette** (10 colors that stay distinct in both themes): `#6366F1 #22D3EE #F472B6 #F59E0B #10B981 #A78BFA #FB7185 #84CC16 #38BDF8 #FACC15`. Assign colors to categories and tags from this palette, in order.
- **Type:** `Inter` (or `Geist`) for UI. All money uses `font-variant-numeric: tabular-nums`. Hero numbers are 40–56px, semibold, with tight tracking.
- **Money component** `<Money cents={} sign="auto|always|never" colorize compact />`. This is the only place money gets formatted (`Intl.NumberFormat`). Compact mode gives `$12.4k`. Positive values can be green, negative values use the default text color (not red, which is too alarming for normal spending) unless `colorize="strict"`.
- **Cards:** `rounded-2xl`, 1px border, subtle inner highlight, `p-5`. Hover lifts by 1px on desktop only.
- **Motion:** Count-up animation on hero numbers (300ms), chart enter animations, skeleton shimmer while loading. Respect `prefers-reduced-motion`.
- **Layout:**
  - Desktop (≥1024px): collapsible left sidebar (Dashboard, Spending, Accounts with each account listed under it, Transactions, Insights, Rules, Settings), plus a top bar with global search (⌘K) and a "Synced 2h ago · Sync now" pill.
  - Mobile (<768px): bottom tab bar (Home, Spending, Accounts, Activity, More). Use sheets/drawers (shadcn `Drawer`/vaul) instead of modals. Pad for safe areas. Touch targets ≥ 44px.
- **Empty states** need a nice illustration or icon, one sentence, and one action.
- **Command palette** (⌘K, shadcn `Command`): jump to an account or page, search transactions, trigger a sync.

---

## Phase 1 — Foundation & shell

**Tasks**
1. `pnpm create next-app` (TS, App Router, Tailwind, ESLint, `src/` dir). Add Prettier, Vitest, and the Playwright config.
2. Install shadcn/ui and add: button, card, input, label, dialog, drawer, sheet, dropdown-menu, select, tabs, tooltip, popover, command, badge, skeleton, separator, switch, sonner (toasts), calendar, table, scroll-area, toggle-group.
3. Implement the design tokens, the theme toggle (dark/light/system, using `next-themes`), and the font.
4. Build the app shell: responsive sidebar plus mobile bottom nav, route placeholders for `/`, `/spending`, `/accounts`, `/accounts/[id]`, `/transactions`, `/insights`, `/rules`, `/settings`.
5. Set up Drizzle + better-sqlite3. DB path comes from `DATABASE_PATH` (default `./data/simplebudget.db`). Use WAL mode. Add the migration script `pnpm db:migrate` and run migrations automatically on server start.
6. Write the full schema from §3 and generate the initial migration. Add the category seed script.
7. Add the `<Money>` component and the `cents` parsing/formatting utils, with unit tests for parsing (`"-0.5"`, `"1234"`, `"1,234.56"` should reject or strip, `"12.345"` rounds half-even or rejects — pick one and test it).
8. Env handling with zod: `APP_SECRET` (≥32 chars, required), `DATABASE_PATH`, `TZ`, `PORT`.
9. Write the Dockerfile and docker-compose (volume `./data:/data`) plus a healthcheck endpoint `/api/health`.

**Acceptance criteria**
- [ ] `docker compose up` serves the shell at :3000. Navigation works on desktop and at 390px width.
- [ ] Theme toggle works and persists.
- [ ] Migrations run on a fresh volume. Categories get seeded.
- [ ] Money util tests pass.

---

## Phase 2 — Auth & onboarding

**Tasks**
1. First run (no password in settings): `/setup` wizard. Step 1 creates the password. Step 2 pastes the SimpleFIN setup token (link to bridge.simplefin.org with a short explainer). Step 3 runs the first sync with progress UI and a 90-day backfill choice (30/90/180/365 days, warning that longer ranges use more of the daily requests). Step 4 confirms the account types (prefilled by guessing: "credit"/"card"/"visa"/"amex" → credit, "saving" → savings, etc.).
2. Login page, `iron-session` cookie (30-day, HTTP-only, SameSite=Lax, `secure` when behind HTTPS), and middleware protecting every route and `/api/*` except `/login`, `/setup`, `/api/health`.
3. Login rate limiting: 5 attempts per 15 minutes per IP, in memory.
4. `src/lib/crypto.ts`: `encrypt(plain)` / `decrypt(blob)` with AES-256-GCM, key derived from `APP_SECRET` via HKDF. Unit test it.
5. Settings → Connections: show connected orgs and the last error, "Add another setup token", "Remove connection" (with confirmation; optionally deletes its data).

**Acceptance criteria**
- [ ] A fresh install forces the setup wizard. After setup, `/setup` redirects to `/`.
- [ ] Every API route returns 401 without a session.
- [ ] The access URL is encrypted in the DB (check with sqlite3 CLI) and never shows up in client bundles or logs.

---

## Phase 3 — Sync engine (most important for stability)

Location: `src/lib/simplefin/` (`client.ts`, `schemas.ts`, `sync.ts`, `parse.ts`).

**Tasks**
1. `client.ts`: `claimSetupToken(token)`, `fetchAccounts({start, end, pending, balancesOnly, accountIds})`. 30-second timeout, 2 retries with exponential backoff for 5xx/network errors only, and a clear error type for 401/403 ("SimpleFIN access revoked — reconnect").
2. `sync.ts` → `runSync({ mode: 'incremental' | 'backfill', days? })`:
   - Take a lock (DB row in `settings` with an expiry) so two syncs never run at once.
   - Check the daily request budget.
   - Fetch windows (newest first). For each response: upsert connections/accounts (preserving user overlay fields), update balances, upsert transactions, reconcile pendings (§2), write today's `balance_snapshots` row per account.
   - Run **rules** (Phase 6) and **transfer detection** (below) on new transactions only.
   - Save `sync_runs` with counts and any `errors[]` from SimpleFIN.
   - Everything for one response runs inside one DB transaction.
3. **Transfer detection** (`src/lib/finance/transfers.ts`): for each new txn, look for an opposite-sign txn of the same absolute amount in a *different* account within ±4 days that isn't already paired. If you find exactly one candidate, pair both rows and set `is_transfer=1`. Also flag description patterns like `/(payment|autopay|transfer|xfer|zelle to self|online banking transfer)/i` when the account type is credit and the amount is positive. Users can unpair/pair manually later.
4. Scheduler: `instrumentation.ts` starts node-cron (`0 */6 * * *` by default, configurable in settings) only in the Node runtime and only once (guard with a global).
5. API: `POST /api/sync` (manual, throttled), `GET /api/sync/status` (last run, running?, requests used today).
6. UI: a sync pill in the top bar with relative time, spinner while running, and a red dot plus a popover listing errors when the last run was partial or failed. Settings → Sync shows the history table of `sync_runs`.
7. **Fixture-based tests:** put 3 realistic SimpleFIN JSON fixtures in `tests/fixtures/` (checking with direct deposits, credit card with purchases plus a payment, savings). Test idempotency (syncing twice adds nothing), pending→posted reconciliation, transfer pairing, and that user overlays survive a re-sync. Mock `fetch`.

**Acceptance criteria**
- [ ] Re-running a sync is idempotent.
- [ ] Edits (category, tags, notes) survive re-sync.
- [ ] A credit card payment from checking gets paired as a transfer automatically.
- [ ] A SimpleFIN `errors` entry shows up in the UI.
- [ ] Daily request cap enforced.

---

## Phase 4 — Accounts (the Actual-style view)

**Routes:** `/accounts` (overview) and `/accounts/[id]` (one per account). The sidebar shows accounts grouped by type (Cash, Credit, Investments, Loans), each with its balance, and an "All accounts" entry at the top. On mobile, `/accounts` is the list and tapping an account opens it.

**Tasks**
1. **Accounts overview:** grouped cards with a group total, a 30-day sparkline per account (from `balance_snapshots`), last-updated time, and a stale warning if `balance_date` > 3 days old.
2. **Account page** header: name (editable inline), institution, balance (hero), available balance, 90-day balance line chart, and stats for this month (in/out/net).
3. **Transaction register** (shared component, reused in Phase 5 for "All transactions"):
   - Columns: date, payee (override or payee or description), category (inline select), tags (chips), amount (colored), running balance (only in single-account view, computed backwards from the current balance), and a pending badge.
   - Group rows by date with sticky date headers. Virtualized. Infinite scroll (page size 100, cursor = `posted,id`).
   - Filters bar: search text, date range presets (this month, last month, 30/90 days, YTD, custom), category, tag, amount range, type (expense/income/transfer), pending/reviewed.
   - Row click opens the **transaction detail** drawer: all raw fields (read-only, "From your bank" section), the editable overlay (payee override, category, tags, notes, mark as transfer/unpair, exclude from stats), a "Create rule from this…" button, and links to the paired transfer.
   - Multi-select (checkboxes on desktop, long-press on mobile) for bulk category/tag/exclude/mark reviewed.
   - Mobile row layout: two lines (payee + amount; category chip + date). Swipe actions are optional.
4. **Account settings** (gear menu): display name, type, color, hide, closed, exclude from net worth.
5. API routes under `/api/accounts` and `/api/transactions` (GET with filters, PATCH single, PATCH bulk). Validate everything with zod.

**Acceptance criteria**
- [ ] Every synced account has its own page reachable from the sidebar or mobile list.
- [ ] The register stays smooth with 10k fake transactions (add `pnpm db:seed-fake`).
- [ ] Running balance matches the bank balance for the newest row.
- [ ] Edits are optimistic (TanStack Query) and roll back on error with a toast.

---

## Phase 5 — Dashboard (Home) & Net worth

**Route `/`** — a responsive grid of cards. 1 column on mobile, 12-col grid on desktop.

1. **Net worth hero:** total (count-up), change vs 30 days ago (amount and %, colored chip), and an area chart with a gradient fill. Range toggle: 1M / 3M / 6M / 1Y / All. The data comes from summing `balance_snapshots` per day, carrying forward the last known balance for missing days. Below it: assets vs liabilities split bar.
2. **This month at a glance:** spent so far, income so far, net, and a "pace" indicator: spent-to-date versus spending at the same day last month, e.g. "$320 less than this point last month".
3. **Cumulative spending chart:** line of cumulative daily spend this month vs last month (dashed) vs the 3-month average (faint). This is the signature chart, so make it look great.
4. **Top categories this month:** donut + list with % and Δ vs last month.
5. **Recent transactions:** the last 8, with a link to all.
6. **Upcoming/recurring** (filled in Phase 7, shows a placeholder until then).
7. **Insights teaser** (filled in Phase 9).
8. **Account balances:** a compact list.

Backend: `GET /api/dashboard?month=YYYY-MM` returns everything in one payload (computed server-side with SQL aggregates). `GET /api/networth?range=`.

Also: `/transactions` — the "All accounts" register (the Phase 4 component with an account column).

**Acceptance criteria**
- [ ] The dashboard loads in < 300ms server time with 10k transactions.
- [ ] Net worth history renders correctly when an account was added mid-history (missing days shouldn't create a drop to 0, so treat days before an account's first snapshot as absent).
- [ ] Looks good at 390px, 768px, and 1440px. Take Playwright screenshots of each and commit them under `docs/screenshots/`.

---

## Phase 6 — Categories, Tags & Rules

1. **Settings → Categories:** CRUD, groups, color/icon picker (from the palette and lucide icons), archive, merge (move txns from A to B), drag to reorder.
2. **Tags:** CRUD, color. Add tags inline from the transaction drawer (create on enter).
3. **Rules** (`/rules`):
   - Builder UI: conditions (field/op/value rows, all/any) → actions.
   - Live preview: "Matches 42 existing transactions" plus a sample list.
   - "Apply to existing transactions" button (by default only touches transactions where the target field is empty, with a checkbox to overwrite).
   - Rules run on newly imported transactions during sync, in priority order. Once a field is set by an earlier rule, later rules can't change it.
   - Shortcut: "Create rule from this transaction" in the drawer prefills `payee contains <normalized payee>` → current category/tags.
4. **Payee normalization** helper (`normalizePayee`): strip `SQ *`, `TST*`, `POS`, card numbers, trailing store numbers/cities, and collapse whitespace. Use it for grouping in stats ("merchants") without changing the stored data. Unit test it with 15+ real-looking examples.

**Acceptance criteria**
- [ ] Rules apply on sync and on demand. Preview counts are accurate.
- [ ] Merging a category moves all of its transactions.

---

## Phase 7 — Spending analytics page

**Route `/spending`** with a month picker (‹ Oct 2026 ›) and a toggle: Month / Custom range.

Sections:
1. **Summary row:** total spent, income, net, savings rate, # of transactions, average per day, largest purchase.
2. **Vs last month & vs 3-month avg:** a bar comparison per category (diverging bars showing Δ), sorted by absolute change. Click a category to filter.
3. **By category:** treemap or donut (user toggle), plus a table with sparkline trend over 6 months.
4. **By tag:** same treatment as categories. Since tags can overlap, label totals "may overlap".
5. **By merchant (normalized payee):** top 15 with count, total, and avg ticket.
6. **By account:** which cards/accounts the spending happened on.
7. **Calendar heatmap:** daily spend for the month. Tap a day to see its transactions.
8. **Day-of-week / time pattern:** small bar chart.
9. **Trends (6–12 months):** stacked bars of monthly spending by top categories, plus an income line.
10. **Recurring / subscriptions detector** (`src/lib/finance/recurring.ts`): group by normalized payee. If ≥3 occurrences with intervals of ~7/14/30/365 days (±20%) and amounts within ±10%, it's recurring. Show the list with next expected date and monthly cost total, and flag price increases. Feed "Upcoming" on the dashboard.

Every number or chart segment should be clickable and open `/transactions` with matching filters pre-applied (encode filters in URL search params; the register reads them).

**Acceptance criteria**
- [ ] All aggregates match a hand-computed check on the fixture dataset (write unit tests for the aggregate functions).
- [ ] Drill-down from any chart lands on a correctly filtered register.

---

## Phase 8 — Optional spending targets (light budgeting)

Not envelope budgeting. Just "I'd like to keep Dining under $400/mo".

1. Settings → Targets: per category or tag, monthly amount, recurring or one month only.
2. Spending page and dashboard: a progress bar for each target, color shifting from accent → warning (≥80%) → negative (>100%), and a projected month-end based on pace.
3. Completely hidden if there are no targets.

**Acceptance criteria**
- [ ] With zero targets, nothing budget-related appears anywhere.

---

## Phase 9 — Insights (rule-based first, LLM optional)

**9a. Deterministic insights** (`src/lib/insights/`), always on. Each generator returns `{id, severity: 'info'|'good'|'warn', title, body, value?, link?}`:
- Category up/down > 25% and > $50 vs 3-month average.
- New merchant with a large spend (> 2× median txn).
- Subscription price increase / new recurring charge detected.
- Unusually large single transaction (> 3σ for that category).
- Spending pace projection: "At this pace you'll spend $X this month (Y% vs avg)".
- Income arrived / direct deposit amount changed.
- Duplicate-looking charges (same merchant and amount within 48h).
- Low balance in checking (< user threshold) or high credit utilization if a limit is known (optional field on account).
- Uncategorized count reminder.

Show them on `/insights` as cards and on the dashboard as the top 3 by severity.

**9b. LLM insights (optional).**
- Settings → AI: provider (`anthropic` | `openai-compatible` with base URL), model (default `claude-sonnet-5-5`), API key (encrypted at rest), and an "enabled" toggle. A clear notice explains that **only aggregated data is sent**: category totals, merchant totals, month-over-month deltas, and the deterministic insights. No account numbers, raw descriptions, or balances unless the user opts in via a checkbox.
- `src/lib/llm/` with one interface `generate({system, user}) → string`. Use the official `@anthropic-ai/sdk` for Anthropic and plain `fetch` for OpenAI-compatible.
- "Monthly summary" button on `/insights` that streams a short narrative (5–8 bullets plus 2–3 suggestions). Cache it in `insights_cache` per month and invalidate it after sync.
- "Ask about your spending" chat box: the server builds context from aggregates, with an optional tool-use loop exposing safe read-only tools (`get_category_totals(month)`, `search_transactions(query, range)` returning at most 50 rows with normalized payee/amount/date/category). Keep it behind the same toggle.
- Every LLM failure degrades gracefully to the deterministic insights.

**Acceptance criteria**
- [ ] The app is fully functional with AI disabled.
- [ ] With AI enabled, the request payload (log it in dev only) contains no raw account ids or access URL.

---

## Phase 10 — Actual Budget parity & migration

Basic features a non-power user expects from Actual. Check each one:
- [ ] Multiple accounts with a register and running balance (Phase 4)
- [ ] Categories and category groups (Phase 6)
- [ ] Payee rules (Phase 6)
- [ ] Transfers between accounts (Phase 3/4)
- [ ] Split transactions → implement: `transaction_splits (id, transaction_id, category_id, amount_cents, notes)`. Splits must sum to the parent amount. Stats use the splits when present. UI in the detail drawer.
- [ ] Notes on transactions
- [ ] Search and filter (Phase 4)
- [ ] Reports: spending by category and net worth (Phases 5/7)
- [ ] Hide/close accounts (Phase 4)
- [ ] Manual (offline) accounts and manual transactions, e.g. cash: `accounts.is_manual`, add/edit/delete txns, set the balance manually. Sync ignores these accounts.
- [ ] Reconcile → simplified "mark reviewed" plus a check: "Bank says $X, app says $Y".
- [ ] Import from Actual: Settings → Import. Accept Actual's **CSV transaction export** (and generic CSV with a column-mapping UI). Match imported rows to SimpleFIN accounts with a user-chosen mapping and to existing txns by (account, date ±2d, amount). For matches, copy over only category/notes. For non-matches older than the SimpleFIN history, insert as `source='import'` rows (add a `source` column: `'simplefin'|'import'|'manual'`). Create categories that don't exist yet. Preview before committing.
- [ ] Export: CSV of all transactions, plus a one-click SQLite backup download.

---

## Phase 11 — Polish, PWA, hardening

1. PWA: manifest, icons (generate a simple gradient logo), `display: standalone`, theme-color matching `--bg`, and a service worker caching static assets only. Add-to-home-screen works on iOS and Android.
2. Privacy mode: a toggle (eye icon in the top bar) that blurs all money values. Persist it in localStorage. Useful in public.
3. Keyboard shortcuts on desktop: `⌘K`, `g d` (dashboard), `g t` (transactions), `/` focus search, `j/k` move in the register, `c` set category.
4. Loading skeletons on every data card, error boundaries per card (one failing card never blanks the page), and toasts for mutations.
5. Accessibility: focus rings, aria labels on icon buttons, chart data also available as a table (toggle), color is never the only signal (+/− signs).
6. Backups: a nightly cron copies the DB using `VACUUM INTO` to `/data/backups/` and keeps the last 14.
7. Logging: pino with redaction of secrets. Settings → About shows version, DB size, last backup.
8. Security headers (CSP, frame-ancestors none), CSRF protection on mutations (SameSite + origin check).
9. Playwright e2e: setup wizard with mocked SimpleFIN → dashboard renders → edit a category → appears on spending page. Run in CI (GitHub Actions: lint, typecheck, unit, e2e, docker build).
10. README: features, screenshots, docker-compose quickstart, env vars, reverse proxy (Caddy) example, backup/restore, and how to get a SimpleFIN token.

**Acceptance criteria**
- [ ] Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95, PWA installable.
- [ ] CI is green.

---

## Phase 12 — Nice-to-haves (only after everything above)
- Cash-flow forecast: projected balance over 30 days from recurring items.
- Goals (savings targets with a progress ring, tracked against an account balance).
- Investment holdings view (SimpleFIN `holdings` when present).
- Year-in-review page.
- Multi-currency display (convert using a static user-set rate).
- Notifications (ntfy/webhook) for large transactions or sync failures.

---

## Suggested folder structure

```
src/
  app/
    (auth)/login, (auth)/setup
    (app)/layout.tsx           # shell
    (app)/page.tsx             # dashboard
    (app)/spending, accounts, accounts/[id], transactions, insights, rules, settings/*
    api/...                    # route handlers (thin; call lib/)
  components/
    ui/                        # shadcn
    money.tsx, charts/*, register/*, shell/*
  db/ schema.ts, client.ts, migrate.ts, seed.ts
  lib/
    simplefin/  finance/  insights/  llm/  crypto.ts  auth.ts  env.ts
tests/ fixtures/ unit/ e2e/
```

## Rules for the implementing agent
- Keep route handlers thin. Business logic goes in `src/lib`, which is unit-tested.
- Never format money outside `<Money>` / `formatCents`.
- Never put secrets in client components. Mark server-only modules with `import "server-only"`.
- Don't add libraries beyond §1 without writing why in `DECISIONS.md`.
- Every chart needs a loading, empty, and error state.
- Test every phase at 390px width before calling it done.
