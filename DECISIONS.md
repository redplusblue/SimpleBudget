# Decisions

- **Money parsing:** `parseCents` rejects thousands separators and inputs with more than two significant decimals (e.g. `"12.345"`); trailing zeros (`"12.500"`) are accepted. No rounding ever occurs.
- **shadcn style:** initialized with `--base radix -p vega` so components use Radix (`radix-ui`), per the plan. The generated `cn` import was rewritten to `@/lib/utils`.
- **Extra libraries beyond §1:** `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css` (shadcn requirements), `cmdk`, `vaul`, `react-day-picker`, `radix-ui` (shadcn components), `server-only` (plan rule), `tsx` (runs `pnpm db:migrate`).
- **pnpm 12:** build scripts must be allow-listed; see `pnpm-workspace.yaml` (`allowBuilds`). `packageManager` is pinned.
- **Env validation is lazy** (`getEnv()`), so `next build` and unit tests don't need `APP_SECRET`.
- **Default categories seed once**, tracked by a `categories_seeded` row in `settings`, so deleting them all is permanent.
- **Compose host port** is configurable via `HOST_PORT` (default 3000).
- **E2E** uses `next start` against the standalone build output, which Next warns about but works.

## Phase 2

- **Wizard scope:** the plan's wizard steps 3–4 (first sync with progress, confirm account types) depend on the Phase 3 sync engine, so Phase 2 ships steps 1–2 (password, connect SimpleFIN) plus "Finish setup". Steps 3–4 are added in Phase 3 by extending `STEPS` in `setup-wizard.tsx`.
- **Setup state** is derived, not stored as one flag: no `password_hash` → `needs-password`; password but no `setup_complete` → `needs-connection`; else `complete`. Finishing requires at least one connection.
- **Public routes:** `/login`, `/setup`, `/api/health`, `/api/auth/login`, `/api/setup/password`. The last only succeeds while no password exists (atomic insert-or-ignore); afterwards it returns 409. Everything else returns 401 (APIs) or redirects to `/login`.
- **Session secret:** iron-session is keyed directly by `APP_SECRET`; stored secrets use an HKDF-derived key, so the two uses don't share key material.
- **Login rate limiting:** counts failed attempts (5 per 15 min per client IP, reset on success). Without a reverse proxy `X-Forwarded-For` is spoofable, so a global cap of 30 failures / 15 min also applies. State is in memory and resets on restart, as the plan specifies.
- **Access URLs** live in `settings` as `access_url:<connectionId>` (AES-256-GCM), since the `connections` table has no column for them. Removing a connection without deleting data detaches its accounts (`connection_id = NULL`) because the FK would otherwise cascade.
- **Claim URL must be https.** A mock SimpleFIN server therefore can't be used by e2e tests; they insert a `connections` row directly and unit tests mock `fetch`.
- **shadcn fix-up:** the generated Radix components used Base UI-style attributes (`data-open`, `data-checked`, …). They were rewritten to `data-[state=…]` so switches, tabs and animations work, and `CardTitle` renders an `h2`.
- **Password minimum** is 10 characters (max 200).

## Phase 3

- **Wizard** now has all four steps (Password → Connect → Import → Accounts). Which step shows is derived from server state (no password / no connection / connections but no accounts / accounts present), so reloads resume correctly.
- **Syncs run in the background.** `POST /api/sync` acquires the lock, validates (cooldown, daily budget, connections) synchronously, then returns 202; the UI polls `/api/sync/status`. Progress is `{done,total}` windows, stored in `settings` while the lock is held.
- **Manual cooldown (15 min) applies only to manual incremental syncs.** Backfills are limited by the daily request budget instead, so a failed first import can be retried at once. Scheduled syncs bypass the cooldown.
- **Daily budget:** 20 requests per UTC day, counting every HTTP attempt including retries. A sync is refused up front if its windows won't fit; mid-run exhaustion stops cleanly and is reported as a partial run.
- **Request windows:** ≤ 60 days, newest first; incremental = last 14 days; backfill = 1–365 days (UI offers 30/90/180/365).
- **Pending transactions** are stored as the bank sends them (`posted = 0`, date taken from `transacted_at`). Reconciliation deletes pending rows missing from a *healthy* response (no SimpleFIN `errors`) inside the synced window, or older than 21 days. Edits move to a newly imported posted transaction with the same amount, within ±5 days, whose normalized description shares a prefix (first 10 alphanumerics); ambiguous ties are skipped.
- **Pending → posted transitions** count as "new" for transfer detection (they weren't eligible while pending).
- **Transfer detection** pairs only when the match is unique in both directions (A's only candidate is B and B's only candidate is A). Unmatched positive credit-card transactions whose description looks like a payment are flagged but left unpaired. It never un-pairs anything.
- **Run rows** are inserted when a sync starts (status `error`, "Sync did not finish.", no `finished_at`) and finalized at the end, so a crash is visible in history.
- **Connection naming:** `connections.org_name` becomes the (up to three) institution names reported by SimpleFIN after the first sync; `last_error` mirrors the latest run's problems for that connection and clears on a healthy sync.
- **Scheduler:** node-cron in the server's `TZ`; choices Off / 3h / 6h (default) / 12h / daily, stored in `settings.sync_schedule`. Hourly is deliberately not offered because it would exceed the 20-request daily cap. If the server was down through a scheduled time, a catch-up sync runs ~30 s after boot.
- **E2E:** a local HTTP mock of the Bridge (`tests/e2e/mock-simplefin.ts`) serves the fixtures with timestamps shifted to "now"; stored access URLs may be `http://` (only the *claim* step requires https).
- **Fixtures:** `tests/fixtures/*.json` hold absolute timestamps anchored at 2026-10-24T12:00Z; unit tests pin `now` to that instant.

## Phase 4

- **Ordering & cursor:** the register lists pending items first, then newest posted. Pending rows have no posted date, so ordering, date filters and the cursor use an "effective date" (purchase date, else first-seen). The cursor is `(pending, effective date, id)`, i.e. the exact sort key, so paging has no gaps or duplicates. (The plan suggested `posted,id`, which can't order pending rows.)
- **Filters:** `from`/`to` are inclusive local dates in the server's `TZ`; the amount range is on the *absolute* amount, in dollars in the URL; search is multi-term AND across description, bank payee, payee override, memo and notes, and a term like `42.18` also matches the amount.
- **Running balance** = bank balance minus everything posted after the row. Shown only on a single-account view with no other filters, never for pending rows (banks don't include pending in the balance), and hidden on mobile where the row has no room for it.
- **Account month stats** (money in / out / net) count posted, non-excluded transactions *including transfers*, since they describe movement in that account. Phase 5/7 spending totals use the expense/income definitions instead.
- **Account groups:** Cash = checking/savings/cash; Credit; Investments; Loans; Other; closed accounts are grouped separately and collapsed. Hidden accounts are omitted from the overview and sidebar.
- **Stale balance:** `balance_date` older than 3 days (or never reported).
- **Virtualization:** window-scrolled list; one layout is rendered per row (mobile or desktop) and in-row category pickers start as lightweight buttons and become a Radix Select on first use. Without this, scrolling 10k rows cost >200 ms p95 frames; with it ~25 ms p95 / ~38 ms max (headless Chromium, 1440px, 10k rows, 25 DOM rows).
- **Tags/categories CRUD** are only partly here: the API lists categories and tags and can create tags (find-or-create by case-insensitive name). Full management UI is Phase 6.
- **"Create rule from this…"** is present but disabled ("Soon") until Phase 6 builds the rule editor.
- **Transfers:** the drawer can flag/unflag a transaction as a transfer (unflagging unpairs both sides) and jump to the other half; manually pairing two arbitrary transactions is not built yet.
- **Dev data:** `pnpm db:seed-fake [--setup]` creates ~10,000 deterministic fake transactions in three `fake-*` accounts (no connection, so syncing never touches them).
- **E2E:** a third server seeded with the fake data runs the 10k-row checks; the list is virtualized, so e2e tests narrow with search before targeting older rows.

## Phase 5

- **Net worth counts every account except hidden ones and ones flagged "exclude from net worth".** A hidden account disappears from every list, so it shouldn't silently move the total (the hide switch says "from lists and net worth"). Closed accounts still count (their balance is normally zero).
- **Assets/liabilities** are by sign, not account type: positive balances are assets, negative balances are liabilities (a card with a credit balance is an asset). Net worth = assets − liabilities, so SimpleFIN's sign convention is used unchanged.
- **Net worth history** is the sum of each account's latest snapshot on or before the day, carried forward; days before an account's first snapshot are *absent* for that account (so adding an account mid-history causes a step *up* on that day, never a dip to zero). Today's point is always replaced by the live balances so the hero number, chart and account list agree.
- **Change vs 30 days ago:** measured from exactly 30 days back when data reaches that far, otherwise from the first day with data ("since Oct 14"); with a single day of history the chip says "Not enough history yet". The percentage uses the absolute baseline, so paying down debt reads as a gain, and is omitted for a zero baseline.
- **Dashboard payload** returns net worth for the default 3M range; other ranges load from `/api/networth?range=` (the chart keeps the previous series on screen while loading). Hero numbers count up over 300 ms (not with reduced motion).
- **Spending** uses the shared expense definition (transfers and excluded items never count; pending purchases count on their purchase date), bucketed by local day in the server `TZ`. Pace compares with last month *to the same day-of-month*; the 3-month average is over the three months before the displayed one, with short months carried at their total.
- **Server-Timing** on `/api/dashboard` reports pure compute time. About 30 ms with 10,000 transactions (the plan's budget is 300 ms); the e2e test asserts on this header rather than wall-clock time, which is skewed by other processes.
- **Placeholders** for Upcoming (Phase 7) and Insights (Phase 9) are static cards.
- **Month picker** isn't on the dashboard (always the current month); the API accepts `?month=` and Phase 7 adds the picker.
- **Overflow checks:** mobile emulation widens the layout viewport when content overflows, which hides the bug from `innerWidth` comparisons (a dashboard grid column briefly did exactly that). The e2e helper `expectNoHorizontalOverflow` compares against the configured viewport instead, and all specs use it.
- **Screenshots** in `docs/screenshots/` come from the 10k-transaction fake dataset: `SCREENSHOTS=1 pnpm test:e2e --project=big tests/e2e/screenshots.spec.ts` regenerates them (the fixed tab bar is hidden for full-page captures).

## Phase 6

- **Rule fields:** `description`, `payee`, `amount`, `account` as in the plan, plus `direction` (money out / in). Without it "amount is more than $1,000" can't tell a big purchase from a paycheck. No new library or schema change: conditions live in `rules.conditions_json`.
- **Payee matching** compares the *cleaned-up merchant name* (the user's payee override, else the bank payee, else the description, run through `normalizePayee`) using `payeeKey`, so a rule for "trader joes" matches `TRADER JOE'S #552 AUSTIN TX`. `description` matches the raw text; regex rules run case-insensitively on the cleaned payee / raw description (max 200 characters, validated when saved).
- **Amount conditions compare size** (absolute value). Use `direction` to restrict to spending or income.
- **First rule wins per field.** Rules run in priority order; a category or payee name set by an earlier rule can't be changed by a later one. Tags are additive across rules. "Mark as transfer" and "exclude from stats" only ever turn *on*.
- **Fill-empty by default.** Imports and "Apply to existing" only fill fields that are still empty; an explicit "replace values that are already set" option overwrites (an earlier rule still wins). A payee override set by a rule changes what *later* rules see only on the next run, never within the same evaluation.
- **When rules run:** on newly imported transactions (after pending→posted edit carry-over, before transfer detection) and on demand. Editing or adding a rule does *not* silently rewrite history; use "Apply to existing…" (with a dry-run count first) or "Run all".
- **Preview** (`/api/rules/preview`) is a dry run of the same code path as applying, for a draft rule *on its own* (other rules are ignored, so the count answers "what does this rule match?"). It reports matches, how many would change, and the 8 most recent matches.
- **Create rule from a transaction** opens `/rules?from=<id>` with `payee contains <cleaned merchant name>` plus the transaction's category and tags.
- **Consistency:** merging a category rewrites rules that set it; deleting a category or tag removes it from rules (a rule left with no actions is removed); removing a connection's data removes rules that reference its accounts. Stored rules that no longer validate are skipped rather than breaking syncs.
- **Categories:** archived categories stay attached to their transactions (rows still show the name, marked "archived") but are hidden from pickers except for the row they're on. Deleting leaves transactions uncategorized; merging moves transactions, budgets and rules. Names are unique case-insensitively.
- **Icons:** a curated set of 40 lucide icons imported by name (not the whole set); colors come from the chart palette.
- **Reordering** uses native HTML5 drag and drop on the grip (desktop) plus "move up / down" buttons everywhere, so no drag-and-drop library was added. The server accepts a slightly stale list (unknown ids ignored, unlisted items keep their order at the end) so a reorder doesn't fail because another tab changed the list.
- **`normalizePayee` limits:** it removes known processor prefixes, phone numbers, dates, masked card digits, store numbers and a trailing "CITY ST". It recognizes multi-word cities only when they start with a common word (SAN, NEW, LOS, FORT, ...); two-letter state codes that are also English words (IN, OR, ME, OK, ...) are only stripped when a city precedes them.
- **Hard-to-test race:** two e2e projects reordering shared lists at once could overwrite each other (a reorder sends the whole list), so each reorder test runs in one project.

## Phase 7

- **`transactions.merchant_key`** (migration 0001): a derived, indexed column holding the normalized merchant (`payeeKey` of the payee override, else bank payee, else description). SQLite triggers keep it current after inserts and after edits to payee / payee_override / description, through a `payee_key()` SQL function that `openSqlite()` registers on every connection. That keeps merchant grouping, the merchant drill-down filter and recurring detection fast SQL, and covers every writer (sync, edits, rules, tests, the seeder) without touching their code. Existing rows are backfilled by the migration. Caveat: writing to `transactions` from the bare `sqlite3` CLI fails because that function only exists inside the app.
- **Range semantics:** a month compares with the previous calendar month and the average of the three months before it; a custom range (≤ 366 days) compares with the equally long period immediately before it and has no 3-month average. All boundaries are inclusive local dates in the server `TZ`.
- **"Purchases"** (the plan's "# of transactions") counts expense transactions only, i.e. what the spending numbers are built from; transfers and excluded items are skipped. Average per day divides by the days that have *happened* in the range, not the whole month.
- **Largest purchase** is the biggest single expense; its tile opens the register filtered to that day with a minimum amount so it shows up first.
- **Comparison bars** sort by the size of the change against the chosen baseline. "Click a category to filter" opens the register for that category in the range, like every other drill-down, rather than filtering the page in place.
- **Merchant drill-down** filters on the exact `merchant_key` (`?merchant=` plus a display-only `mname`), not a fuzzy text search; the register shows a removable "Merchant: …" chip. The weekday bars are **not** clickable: transactions have no reliable time of day and a weekday filter would need timezone-aware SQL per row.
- **Heatmap** shades relative to the 90th-percentile day (one rent payment shouldn't turn every other day pale); days after today are dimmed and not clickable-by-data.
- **Recurring detection:** at least 3 posted charges per merchant, spacing within ±20% of 7 / 14 / 30 / 365 days (75% of gaps must fit, so one skipped month is tolerated), amounts within ±10% of typical, except that a final jump on the latest charge after a steady run is allowed and flagged as a price increase (≥ 2%). A charge more than a week (or half a cadence) late is treated as stopped and excluded from totals. Weekly/biweekly/yearly charges are converted to a monthly cost. Quarterly and irregular schedules are not detected. Yearly detection needs ~3 years of history to ever fire.
- **Dashboard "Upcoming"** shows detected charges due within 30 days (late ones first) and the monthly total; detection runs on each dashboard load (~55 ms with 10,000 transactions).
- **12-month trend** stacks the top five categories (by 12-month spend) plus "everything else", with income as a line; the last month is always the whole month, even for a custom range that ends mid-month.
- **Tests:** aggregates are checked against a hand-computed dataset (`tests/unit/spending-report.test.ts`); drill-downs are verified on 10,000 transactions by comparing the register's total with the report's count for a category, a merchant and a calendar day.

## Phase 8: spending targets

- **Integrity in the database.** Migration 0002 adds triggers (a target has exactly one of category or tag) and partial unique indexes (one recurring target, plus at most one per specific month, per subject). The API also checks, to return friendly 409 messages.
- **Month override.** A target set for a specific month replaces the recurring one for that month; other months' targets are ignored.
- **Thresholds.** Accent below 80%, amber from 80% through exactly 100%, red only above 100%. Status is also written as text, so color is never the only signal.
- **Projection.** Month-end pace = spent x days in month / days elapsed, shown only for the current month from day 3 on. Past months show none.
- **Spending page.** Targets appear only for single-month views, since limits are monthly; custom ranges show none.
- **Optional by design.** No targets means no card and no nav tab. The Targets settings tab appears once one exists; the first is added from a category's or tag's "Set monthly target..." menu item.
- **Category merge.** The destination keeps its own target on a scope clash; the merged category's duplicate is dropped (reported as `targetsDropped`).
- **e2e.** The targets spec has its own 10k-transaction server (port 3103) because it adds transactions and targets; it inserts expenses straight into that test database, registering `payee_key()` on the connection.

## Phase 9a: deterministic insights

- **Always on, local only.** `src/lib/insights/` computes everything from the database; nothing is sent anywhere. `/api/insights` and the dashboard teaser work with AI absent.
- **Order.** Warnings, then good news, then notes; generator order within a level. The dashboard shows the top 3.
- **Partial months.** Category changes compare month-to-date with the 3-month average scaled to the same day, and stay silent for the first 7 days. Pace needs 5 days and some history.
- **New merchants** need 45 days of history, otherwise everything would look new.
- **Large transactions** use a baseline that excludes the last 14 days (so the outlier doesn't inflate its own sigma), require 10 samples in the category, and also 1.5x the mean and $50, to avoid noise on near-constant categories such as rent.
- **Utilization:** info from 30%, warn from 50%. Credit limit and low-balance alert are optional per-account fields (migration 0003), edited in the account settings dialog.
- **Isolation.** A generator that throws is skipped (and logged by the API) rather than failing the page.
- **Cost.** Expense/income rows (1 year) and the recurring report are computed once per request and shared; the dashboard hands over the recurring report it already has. Dashboard compute is ~150 ms on 10k transactions over two years.

## Phase 9b: optional LLM features

- **(Superseded, see "AI: OpenAI-compatible only" below.)** Originally `@anthropic-ai/sdk` for Anthropic plus `fetch` for OpenAI-compatible servers.
- **(Superseded.)** Originally defaulted to `claude-sonnet-5-5`.
- **What leaves the server:** only what `src/lib/llm/context.ts` assembles (category, merchant and month-over-month totals, plus an allow-list of insights). Insights are filtered by id prefix, so a new generator is excluded until someone adds it to the list. Account names/balances (and the low-balance/utilization insights) need the opt-in checkbox. The two tools return normalized payee, date, amount and category for at most 50 rows. Tests assert that neither a summary nor a tool-using question contains an account id, the access URL, a memo or a note.
- **Key storage:** AES-256-GCM via the same secret box as the SimpleFIN access URL; write-only through the API (responses only say `hasKey`).
- **Base URL:** any http(s) URL is accepted, because local servers (Ollama, LM Studio) are a main use case and only the signed-in owner can set it.
- **Caching:** one saved summary per month in `insights_cache`; it counts as stale once a sync has finished after it was written, so no hook into the sync code is needed.
- **Streaming:** the summary endpoint streams newline-delimited JSON events (text, done, error) so a failure mid-answer can still be reported; questions return one JSON answer.
- **Failures degrade:** every provider problem becomes a short message (bad key, rate limit, declined, unreachable) next to a reminder that the insights are unaffected. Nothing in the app depends on AI being on.
- **Dev logging:** with `NODE_ENV=development` the outgoing payload and tool results are printed; never the key.

## Phase 10: Actual Budget parity and migration

- **Splits.** A split transaction keeps no category of its own; its parts carry them. Category views (dashboard breakdown, spending report, targets, register category filter) count the parts, while totals, merchants, accounts and days still use the whole purchase. Picking a single category (inline, drawer, bulk, manual edit) replaces the split; rules never overwrite one; a SQLite trigger drops a split if the amount changes (a bank revising a pending charge), because it would no longer add up. Splits must have the same sign as the purchase. Income-category flags are not consulted per part (the parent decides whether it is an expense).
- **Manual accounts.** `accounts.is_manual`, no connection; sync only touches accounts the bank returns, so they are ignored by construction (tested). Adding, editing or deleting a manual transaction moves the balance by the difference and writes today's snapshot; "Set balance" overrides it after counting the cash. They are never "stale". Only transactions with `source='manual'` can be edited or deleted this way.
- **Reconcile** compares a statement balance with the app's own records at the end of that local day (today's balance minus everything posted later, pending left out, the same arithmetic as the register's running balance). Only a matching period can be marked reviewed.
- **Import.**
  - Accepts Actual's CSV export directly (Account, Date, Payee, Notes, Category, Amount) or any CSV via column mapping (signed amount or debit/credit columns, three date formats, optional sign inversion).
  - Matching: same account, same amount, dates within 2 days, one-to-one, nearest first. **Matches only fill empty fields** (category, notes) instead of overwriting, so work you've already done in SimpleBudget is never lost. This is my reading of "copy over only category/notes".
  - Non-matches are inserted (`source='import'`) only if they are older than the account's synced history; non-matches inside it are skipped as probable duplicates and counted in the preview.
  - New categories are created; a category that only ever receives money is marked income. Imported rows are marked reviewed (you already reviewed them in Actual). Account balances are not changed by imported history. Rules and transfer detection run on inserted rows.
  - Re-importing the same file changes nothing (rows match what the first run inserted).
- **Export.** CSV of every transaction (formulas defused so spreadsheets don't execute payees), and a consistent SQLite copy via `VACUUM INTO`. The backup contains the encrypted bank access URL and the password hash; the page says so.
- **Not done:** Actual's budget-envelope data and category groups are not part of its transaction CSV, so they aren't imported.

## Phase 11: polish, PWA, hardening

- **New dependency:** `pino` for logging (the plan asks for it). Logs redact secret-named keys and scrub `user:pass@` URLs and API-key-looking tokens from messages and errors.
- **PWA.** Manifest, icons drawn on request by `next/og` (so no binaries in the repo), and a service worker that caches only `/_next/static/*` and `/icons/*`. Pages and every `/api` response always come from the network, so financial data is never stored by the worker or served stale.
- **Privacy mode** is a CSS blur on `[data-money]`, `[data-sensitive]` and chart text, switched by an attribute on `<html>` that an inline script sets before first paint (no flash of real numbers). Free text that contains amounts (insights, AI answers) is marked `data-sensitive`.
- **Shortcuts** pause while typing, while a picker/menu has focus, and while any dialog is open. The register's `j k Enter c` act on a highlighted row.
- **Error handling:** every dashboard and spending card sits in its own boundary, `(app)/error.tsx` keeps the shell on a page crash, and `global-error.tsx` is the last resort.
- **Charts as tables:** net worth/balance, spending pace, weekday and trend charts have a "View as table" switch. The category donut and the calendar already have text equivalents (the list and per-day labels), so they don't.
- **Security headers:** a CSP with `'unsafe-inline'` for scripts and styles (Next injects small inline scripts for hydration; nonces would require dynamic rendering of every page) but no `'unsafe-eval'`, `frame-ancestors 'none'`, plus the usual nosniff/referrer/permissions headers and HSTS when `COOKIE_SECURE=true`. Zod's `new Function` probe would violate that CSP, so it is switched off in the browser (`z.config({ jitless: true })`).
- **CSRF:** the session cookie is `SameSite=Lax`, and middleware also refuses any mutating request whose `Origin` (or `Sec-Fetch-Site`) says it came from another site, honouring `X-Forwarded-Host`. Requests with neither header (curl, scripts) still need the cookie.
- **Backups:** nightly 03:30 via `VACUUM INTO` (written to a `.partial` file and renamed), mode 0600, newest 14 kept, only files with the app's own naming are ever deleted.
- **Performance (Lighthouse mobile, simulated throttling, demo data):** Dashboard 85-88, Accounts 92, Insights ~83, Spending ~79, Transactions ~66; accessibility 94-100; best practices 100. What got the dashboard there:
  - it is rendered on the server (real numbers in the first HTML) instead of fetching after hydration;
  - charts, the palette/dialog code and below-the-fold cards download only when needed (`LazyMount` + `next/dynamic`); upcoming charges and insights load on their own when scrolled into view;
  - the net-worth chart is a small hand-written SVG, so the dashboard no longer loads Recharts at all on first paint;
  - a system font stack instead of a 49 KB web font, and an SVG favicon.
  Transactions is the lowest: its first rows are drawn client-side by the virtualized list, so the first paint waits for JavaScript. Server-rendering rows would need time-zone-safe day headers; left for later.
- **Accessibility fixes found by Lighthouse:** a separate `--link` color for accent-colored text (the brand indigo is 4.1:1 on the dark background), and a lighter red in dark mode for negative amounts.

## Phase 12: extras

- **Holdings** come from SimpleFIN's optional `holdings` list. They are replaced only when a response actually includes the field, so a balances-only response never wipes them. Gain/loss uses the institution's cost basis and leaves out positions without one.
- **Goals** track an account balance. "Already there" is money in the account that isn't part of the goal, so a shared account works. The pace is the account's growth over the last 90 days (needs a week of history); a goal with a deadline is "on track" when that pace reaches it in time.
- **Forecast** starts from checking, savings and cash accounts and uses only what repeats (recurring bills and regular deposits found with the same detector as the Spending page). A second line subtracts typical everyday spending (last 90 days minus the recurring bills). Credit-card charges are counted on the expected day, as if paid immediately. It does not guess at irregular income.
- **Year in review** is built on the spending report for a custom range, so its numbers match the Spending page; the "vs the year before" comparison uses the preceding period of equal length.
- **Multi-currency is display-level.** Everything is shown in US dollars; you set what one unit of each other currency is worth, and net worth (total, chart and assets/liabilities) and account-group totals convert at that rate. Rates never update themselves; without one a currency counts 1 to 1 and the dashboard says so. Spending analytics (categories, merchants, targets) still add up raw amounts, so they assume your accounts share a currency. Making those convert too would mean changing every aggregate query; left out on purpose.
- **Alerts** are off by default and generic by default (the message says an amount, not who it was with) because a public ntfy topic is readable by anyone who knows its name. Only rows inserted by that sync can trigger one, at most five per sync, and a failure is announced at most every six hours. The destination and token are stored encrypted and never returned by the API.

## AI: OpenAI-compatible only (supersedes parts of Phase 9b)

- **One protocol.** The owner runs OpenRouter or an Open WebUI instance, so the Anthropic SDK and the provider switch were removed (`@anthropic-ai/sdk` is no longer a dependency). Everything goes through `src/lib/llm/openai-compatible.ts` (plain `fetch`, streaming, tool loop). Claude models are still usable *through* OpenRouter (`anthropic/claude-...`).
- **Settings** are now: server address (default `https://openrouter.ai/api/v1`), model (required, no default, because model ids differ per server), optional API key. Turning AI on requires an address and a model. The old `ai:provider` setting is ignored.
- **Compatibility shims:** retry with `max_completion_tokens` when a model rejects `max_tokens`; retry once without `tools` when the server rejects tool use (answers then use the summary only).
- **Docs:** `docs/AI.md` has setup for OpenRouter and Open WebUI.

## AI: richer tools, bulk categorizing, MCP

- **Bulk categorizing is a manual CLI, not a button or a cron job**, so spending money is always a deliberate act. It groups by distinct payee (and direction) instead of by transaction, previews the plan and asks before sending, caps payees/calls per run, saves proposals to a file so applying never costs a second call, and writes only empty categories at or above a confidence bar (default `high`). Optional `--make-rules` turns each answer into a normal payee rule so the model is asked about a merchant once.
- **One analysis module** (`src/lib/llm/analysis.ts`) feeds the in-app tools, the MCP server and the export, so they cannot disagree and cannot expose anything the allow-list in `context.ts` doesn't.
- **MCP server is hand-rolled** (about 100 lines of JSON-RPC over stdio: initialize, ping, tools/list, tools/call) instead of adding `@modelcontextprotocol/sdk`, matching the no-vendor-SDK stance of the AI client. It opens SQLite read-only. If the protocol surface grows (resources, prompts, HTTP transport), switch to the SDK and record it here.
- CLIs run through `tsx --conditions=react-server` so that `server-only` resolves to its empty module outside Next.

## Documentation and handoff

`AGENTS.md` (fast path for agents), `CLAUDE.md` (points to it) and `docs/` (architecture, API table, development, operations, AI, Actual migration) were written so that a new agent can continue without the original conversation. Keep them current: when you change behaviour, update the doc that describes it in the same commit.
