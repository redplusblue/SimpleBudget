# Development guide

## Setup
Requirements: Node 20+ (CI uses 22; Node 25 works), pnpm 12 (`corepack enable`; the version is pinned by `packageManager`).
```bash
pnpm install
export APP_SECRET=$(openssl rand -hex 32)     # >= 32 chars; or put it in .env.local (see .env.example)
pnpm dev                                      # http://localhost:3000 (if the port is taken: pnpm dev -p 3300)
pnpm db:seed-fake --setup                     # demo data into DATABASE_PATH (default ./data/simplebudget.db); log in with "password1234"
```
First run without data shows the setup wizard (password → SimpleFIN token → import history → confirm accounts). Without a real SimpleFIN token use the demo seed.

## Scripts
| Script | What |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` (both cover `tests/` too) |
| `pnpm test` | Vitest unit tests (`tests/unit/**`), in-memory SQLite, no network |
| `pnpm build` / `pnpm start` | production build (standalone output) / run it |
| `pnpm test:e2e` | Playwright against a production build (builds are **not** automatic: run `pnpm build` first) |
| `pnpm db:generate` | new migration from `src/db/schema.ts` changes |
| `pnpm db:migrate` | apply migrations to `DATABASE_PATH` |
| `pnpm db:seed-fake [--setup]` | demo data (3 bank accounts, 2 investment accounts with holdings, ~10k transactions) |

**Before every commit:** `pnpm lint && pnpm typecheck && pnpm test`. Before finishing a UI change also run the relevant e2e specs.

## Testing
### Unit (`tests/unit`)
- `tests/helpers/db.ts`: `freshDb()` (in-memory DB with all migrations), `addAccount`, `addTxn`, `categoryId`, `addTag`. The default seed categories exist (Groceries, Dining, Rent/Mortgage, …).
- Fix `now` and the time zone in tests (`const NOW = zonedDayStart("2026-10-24", "UTC") + 12*3600`). Hand-compute expected numbers; don't mirror the implementation.
- SimpleFIN is faked by `tests/helpers/simplefin-mock.ts` (a `fetch` stand-in that filters by date like the real Bridge) and `tests/fixtures/*.json`.
- `server-only` is stubbed (`tests/stubs`), so server modules import fine. `.tsx` files are **not** transformed by Vitest: keep testable logic in `.ts` files (that's why `split-math.ts`, `*-types.ts`, `range-state.ts` exist).
- Every API path must be listed in `tests/unit/middleware.test.ts`.

### End to end (`tests/e2e`, Playwright)
Projects (see `playwright.config.ts`), each with its own server and SQLite file, started by Playwright (`next start` on ports 3100-3103; mock bank on 3199):
| Project | Server | Used for |
| --- | --- | --- |
| `desktop` (1440px), `mobile` (390px) | fixture install built from the mock bank (`global-setup.ts`) | dashboard, register, spending, taxonomy, rules, sync, shell |
| `fresh-mobile` | empty DB | the setup wizard |
| `big` | 10,000 fake transactions | performance and drill-down consistency |
| `targets` | its own 10k-transaction DB (port 3103) | every feature spec that *writes data* (targets, insights, ai, splits, manual, import, reconcile, polish, console, phase12) |

Tips and traps:
- **Rebuild before e2e** (`pnpm build`), and kill stale servers if a run was interrupted: `ss -ltnp | grep -E ':(3100|3101|3102|3103|3197|3198|3199) '` then kill the pid. "Address already in use" means a stale server.
- Heavy dashboard/spending cards mount lazily. After navigating, call `await revealLazy(page)` (from `tests/e2e/helpers.ts`) before asserting on them. Charts are asserted by their drawn `svg`, not just their container (a zero-height container renders nothing).
- Specs that share a server run in `serial` mode and use unique names (`E2E …`) so they don't collide; clean up what they create.
- Use `insertExpense(dbPath, …)` / `insertForeignAccount` (helpers) to seed rows directly when there's no UI for it.
- `expectNoHorizontalOverflow(page)` checks the 390px layout. `console.spec.ts` fails on any console error, 4xx/5xx or CSP violation across the main pages.
- Regenerate README screenshots: `SCREENSHOTS=1 pnpm test:e2e --project=big tests/e2e/screenshots.spec.ts`.

### Lighthouse
```bash
# demo server (any port), logged in via cookie:
APP_SECRET=… DATABASE_PATH=./data/demo.db pnpm exec next start -p 3300
COOKIE=$(curl -si -X POST localhost:3300/api/auth/login -H 'content-type: application/json' -d '{"password":"password1234"}' | grep -i ^set-cookie | head -1 | sed 's/^[^:]*: //; s/;.*//')
CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | tail -1) \
  pnpm dlx lighthouse http://127.0.0.1:3300/ --chrome-flags="--headless=new --no-sandbox" --extra-headers="{\"Cookie\":\"$COOKIE\"}" --view
```
Default is mobile with simulated throttling. In that model the score tracks **bytes of JavaScript downloaded at load** and main-thread work; keep first-load bundles small.

## Recipes
### Add a column or table
1. Edit `src/db/schema.ts`. 2. `pnpm db:generate` and review the SQL in `drizzle/`. 3. For constraints Drizzle can't express (triggers, partial indexes), generate a custom migration: `pnpm exec drizzle-kit generate --custom --name=<name>` and write SQL (see `0002`, `0005`). 4. Never edit an applied migration. 5. Update `docs/ARCHITECTURE.md`'s table list.

### Add a page
`src/app/(app)/<route>/page.tsx` (server component; export `metadata`) renders a client component in `src/components/<feature>/`. Add the route to `NAV_ITEMS`/`MORE_ITEMS` in `src/components/shell/nav.ts`. Give it loading, empty and error states; wrap cards in `CardBoundary` when several share a page; test at 390px. For data-heavy first paint, compute on the server and pass `initialData` (see `(app)/page.tsx`).

### Add an API endpoint
See the checklist at the end of [`API.md`](API.md).

### Add an insight
Add a `Generator` in `src/lib/insights/generators.ts`, append it to `GENERATORS`, write a hand-computed test in `tests/unit/insights.test.ts`. Ids are stable strings (`kind:subject:month`). If the AI may mention it, add its id prefix to `SPENDING_INSIGHTS` in `src/lib/llm/context.ts`; otherwise it is invisible to the AI (the default).

### Add a setting
Use `getSetting/setSetting` (`src/lib/settings.ts`) with a namespaced key (`feature:name`). Secrets go through `encrypt/decrypt` and must be write-only in the API (return `hasX`, never the value).

### Change a spending number
Edit the shared definitions (`sql.ts`) or the aggregator, then check *all* of: dashboard (`spending.ts`), report (`spending-report.ts`), targets (`targets.ts`), register filters (`transactions-query.ts`), insights data (`insights/data.ts`). The e2e `big.spec` checks that drill-downs show the same count as the report.

## Conventions
- TypeScript strict; no `any` (a few `eslint-disable` exist in test helpers). Prettier formats everything (`pnpm format`); run it before committing.
- Comments explain *why*, not what. Match the surrounding style.
- UI: 44px touch targets on mobile (`h-11 md:h-9`), color is never the only signal, icon buttons have `aria-label`s, accent *text* uses `text-link` (contrast), not `text-primary`.
- Names for user data in tests/fixtures are fake. Never commit real bank data, tokens, or `.env` files.

## Pitfalls we hit (so you don't)
- **Prettier reformats JSX**, so scripted `str.replace` edits can silently miss. Grep after scripted edits and run `pnpm typecheck`.
- **`ResponsiveContainer` height 0**: a Recharts chart inside an element with only `min-height`/`flex-1` can render nothing. Give the chart wrapper an explicit height.
- **Recharts statically imported** in a client component the dashboard renders pulls ~120 KB gzip into first load; use `next/dynamic` + `LazyMount`.
- **Zod and CSP**: zod 4 probes `new Function`, which violates our CSP; `src/lib/zod-config.ts` turns that off in the browser and must stay the first import in `providers.tsx`.
- **Hydration mismatches**: don't format timestamps in the browser's time zone inside server-rendered output (the register's rows are client-rendered for this reason).
- **Bare `sqlite3` CLI** cannot write `transactions` (needs the `payee_key()` function). Use scripts that go through `openSqlite()`.
- **Parallel e2e on shared DBs**: reordering tests overwrite each other; keep such tests in one project.
