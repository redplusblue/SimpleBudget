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
