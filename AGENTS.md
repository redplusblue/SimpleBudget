# AGENTS.md: start here

You are picking up **SimpleBudget**, a self-hosted, single-user personal-finance dashboard fed by SimpleFIN Bridge.
All 12 phases of [`PLAN.md`](PLAN.md) are implemented. This file is the fast path; the deep dives are in [`docs/`](docs/README.md).

## Read in this order
1. This file (rules, commands, traps).
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit, where every feature lives, the data model.
3. [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): setup, testing, recipes for common changes, pitfalls.
4. [`DECISIONS.md`](DECISIONS.md): *why* things are the way they are. Check it before changing behaviour; add to it when you make a judgment call.
5. [`docs/API.md`](docs/API.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md), [`docs/AI.md`](docs/AI.md), [`docs/MIGRATING-FROM-ACTUAL.md`](docs/MIGRATING-FROM-ACTUAL.md) as needed.

## Commands
```bash
pnpm install
pnpm dev                          # needs APP_SECRET (>= 32 chars) in the environment
pnpm lint && pnpm typecheck && pnpm test   # must pass before every commit (unit tests: Vitest)
pnpm build && pnpm test:e2e       # Playwright; runs against a PRODUCTION build, so rebuild after changing src/
pnpm db:seed-fake --setup         # demo database: ~10k fake transactions, password "password1234"
pnpm ai:categorize                # manual, paid: LLM categorizes uncategorized payees (preview first; docs/AI.md)
pnpm ai:export / pnpm mcp         # free: markdown snapshot for a chat LLM / read-only MCP server
pnpm db:generate                  # drizzle-kit: new migration after editing src/db/schema.ts
```

## Rules that matter (the non-obvious ones)
- **Money is integer cents.** Format only through `<Money>` (`src/components/money.tsx`) or `formatCents` (`src/lib/finance/cents.ts`). SimpleFIN sign convention: negative = money out (credit cards have negative balances).
- **Spending/income definitions live in one place:** `expenseCondition`, `incomeCondition`, `effectiveDateSql` in `src/lib/finance/sql.ts`. Never re-derive them. Transfers and excluded rows never count.
- **A split transaction has no category of its own**; its parts (`transaction_splits`) carry them. Anything that groups by category must count the parts (`src/lib/finance/split-lines.ts`, `noSplitsSql`).
- **`transactions.merchant_key` is maintained by SQLite triggers** that call a custom `payee_key()` function registered in `openSqlite()`. Any new connection that writes `transactions` must come from `openSqlite()` (the bare `sqlite3` CLI cannot).
- **Time zones:** the server `TZ` decides which local day/month a transaction belongs to. Use the helpers in `src/lib/finance/dates.ts`; pending rows use `transacted_at ?? imported_at`.
- **Server-only modules** start with `import "server-only"`. Never import them into client components; share *types* via `*-types.ts` files, which are client-safe.
- **Route handlers stay thin**: parse, call `src/lib/...`, map errors with `errorResponse` (`src/lib/api-errors.ts`). Business logic lives in `src/lib` and is unit-tested.
- **Every new `/api` route must be added to `tests/unit/middleware.test.ts`** (it asserts a 401 without a session) and uses `requireApiAuth()`.
- **Secrets** (SimpleFIN access URL, AI key, alert destination) are encrypted with `src/lib/crypto.ts` and are write-only through the API. Logs go through `src/lib/logger.ts` (redacts secrets). Never log URLs that may contain tokens.
- **Don't add libraries** without writing why in `DECISIONS.md`.
- **Every chart/card needs loading, empty and error states**, and must fit 390px wide with no horizontal scroll (`expectNoHorizontalOverflow` in e2e).
- **Performance budget:** the dashboard is server-rendered (`initialData`), heavy cards are `LazyMount`ed and chart libraries load via `next/dynamic`. Don't statically import Recharts into something the dashboard renders above the fold. Re-check with Lighthouse (see `docs/DEVELOPMENT.md`).
- **CSP has no `unsafe-eval`.** Anything that uses `eval`/`new Function` will log a CSP violation (an e2e test fails on this).

## Git conventions
Small, verbose commits (what changed *and why*), one concern each; end the message with the `Co-Authored-By` trailer your tooling prescribes. **Don't push** unless the owner says so.

## Where to look when…
| You want to… | Start at |
| --- | --- |
| change how bank data is pulled | `src/lib/simplefin/` (`sync.ts` is the engine), `docs/ARCHITECTURE.md#sync` |
| change a spending number | `src/lib/finance/spending-report.ts`, `spending.ts`, `sql.ts` |
| add a page | `src/app/(app)/<route>/page.tsx` + a component under `src/components/<feature>/`; add to `src/components/shell/nav.ts` |
| add a table/column | edit `src/db/schema.ts`, `pnpm db:generate`, commit the SQL in `drizzle/` |
| add an insight | `src/lib/insights/generators.ts` (+ allow-list in `src/lib/llm/context.ts` if the AI may see it) |
| touch AI | `src/lib/llm/` (tools in `tools.ts`, shared reports in `analysis.ts`), `src/lib/mcp/`, `docs/AI.md` |
| import/export | `src/lib/import/`, `src/lib/export/` |

## Status and known gaps
- Done: Phases 1-12 of `PLAN.md`. AI enhancement plan (`docs/plans/ai`): Phase 0 done (model list, per-feature models, `ai_runs` cost tracking, monthly budget). Test suites: ~700 unit tests, ~150 e2e tests.
- Lighthouse mobile (demo data): Dashboard 85-88, Accounts ~92, Insights ~83, Spending ~79, **Transactions ~66** (first rows render client-side; fixing needs time-zone-safe day headers for SSR).
- Multi-currency conversion covers balances and net worth only; spending analytics assume one currency (`DECISIONS.md`, Phase 12).
- One known e2e flake under full-suite load: `taxonomy.spec.ts` "reordering with the move buttons persists" (mobile). It passes alone.
- Actual's envelope budgets and category groups are not imported (not in its transaction CSV).
