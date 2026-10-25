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
