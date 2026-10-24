# Decisions

- **Money parsing:** `parseCents` rejects thousands separators and inputs with more than two significant decimals (e.g. `"12.345"`); trailing zeros (`"12.500"`) are accepted. No rounding ever occurs.
- **shadcn style:** initialized with `--base radix -p vega` so components use Radix (`radix-ui`), per the plan. The generated `cn` import was rewritten to `@/lib/utils`.
- **Extra libraries beyond §1:** `clsx`, `tailwind-merge`, `class-variance-authority`, `tw-animate-css` (shadcn requirements), `cmdk`, `vaul`, `react-day-picker`, `radix-ui` (shadcn components), `server-only` (plan rule), `tsx` (runs `pnpm db:migrate`).
- **pnpm 12:** build scripts must be allow-listed; see `pnpm-workspace.yaml` (`allowBuilds`). `packageManager` is pinned.
- **Env validation is lazy** (`getEnv()`), so `next build` and unit tests don't need `APP_SECRET`.
- **Default categories seed once**, tracked by a `categories_seeded` row in `settings`, so deleting them all is permanent.
- **Compose host port** is configurable via `HOST_PORT` (default 3000).
- **E2E** uses `next start` against the standalone build output, which Next warns about but works.
