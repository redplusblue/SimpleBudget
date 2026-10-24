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
