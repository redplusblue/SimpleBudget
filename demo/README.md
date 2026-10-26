# GitHub Pages demo

A read-only copy of SimpleBudget with fake data, published at `https://<owner>.github.io/<repo>/`.

## How it works
GitHub Pages serves only static files, but SimpleBudget needs a server and a database. So `build.mjs`:
1. seeds a throwaway database with `pnpm db:seed-fake --setup` (~10k fake transactions),
2. builds and starts the real app with `NEXT_BASE_PATH=/<repo>`,
3. logs in and saves every page's server-rendered HTML and the `/api` GET responses the pages ask for
   (dashboard, 12 months of spending, net worth ranges, five years in review, the first 500 transactions, each account...),
4. writes them to `demo-out/` together with `.next/static` and `shim.js`.

In the browser `shim.js` runs first, answers `/api/*` GETs from the saved JSON, refuses writes with a friendly message
("read-only demo"), sends client-side navigation down the normal full-page-load path, and shows a small banner.

Not available in the demo: anything that changes data, AI features, filtering the transactions register
(only the default view and the first five pages are saved; other filters show "isn't included in the demo"), and
custom date ranges other than the presets.

## Run it locally
```bash
DEMO_BASE_PATH=/SimpleBudget node demo/build.mjs        # writes ./demo-out (slow: runs pnpm build)
mkdir -p /tmp/site && ln -sfn "$PWD/demo-out" /tmp/site/SimpleBudget
python3 -m http.server 8801 --directory /tmp/site        # open http://127.0.0.1:8801/SimpleBudget/
```

## Publishing
`.github/workflows/demo.yml` runs on every push to the `demo` branch (and manually). One-time: in the repository
**Settings → Pages**, set **Source** to **GitHub Actions**. To refresh the demo after changing the app, merge `main`
into `demo` and push. The saved pages show "this month" as of the build day, so rebuild now and then.
