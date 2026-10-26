#!/usr/bin/env node
/**
 * Builds the GitHub Pages demo into ./demo-out (or $DEMO_OUT).
 *
 * GitHub Pages only serves static files, but SimpleBudget needs a server and a database. So this script runs the
 * real app against fake data, saves what it renders (the pages) and what it answers (the /api GET responses),
 * and ships those with demo/shim.js, which replays the saved answers in the browser and refuses writes.
 *
 *   DEMO_BASE_PATH=/SimpleBudget node demo/build.mjs        # default base path: /SimpleBudget ("" for a custom domain)
 *
 * Prerequisites: pnpm install. The script runs the seed, `pnpm build`, and a local server on $DEMO_PORT (3917).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.DEMO_BASE_PATH ?? "/SimpleBudget").replace(/\/+$/, "");
const PORT = process.env.DEMO_PORT ?? "3917";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(root, process.env.DEMO_OUT ?? "demo-out");
const WORK = path.join(root, ".demo-work");
const PASSWORD = "password1234"; // what `db:seed-fake --setup` sets

const env = {
  ...process.env,
  APP_SECRET: "demo-build-secret-demo-build-secret-0123456789",
  DATABASE_PATH: path.join(WORK, "demo.db"),
  TZ: "UTC",
  PORT,
  HOSTNAME: "127.0.0.1",
  NEXT_BASE_PATH: BASE,
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

// Must match demo/shim.js.
function apiKey(pathname, search = "") {
  const sorted = new URLSearchParams(Array.from(new URLSearchParams(search).entries()).sort()).toString();
  return pathname + (sorted ? `?${sorted}` : "");
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.join(OUT, "demo-data"), { recursive: true });

run("pnpm", ["db:seed-fake", "--setup"]);
run("pnpm", ["build"]);

console.log("Starting the app...");
const server = spawn("pnpm", ["exec", "next", "start", "-H", "127.0.0.1", "-p", PORT], {
  cwd: root,
  env,
  stdio: "inherit",
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);

async function main() {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${ORIGIN}${BASE}/api/health`)).ok) break;
    } catch {}
    if (i > 120) throw new Error("The app did not start");
    await new Promise((r) => setTimeout(r, 500));
  }

  const login = await fetch(`${ORIGIN}${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`Demo login failed (${login.status})`);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const get = (p) => fetch(`${ORIGIN}${BASE}${p}`, { headers: { cookie }, redirect: "manual" });

  // ---- API snapshots -------------------------------------------------------------------------------------------
  const manifest = {};
  let n = 0;
  async function snapshot(p) {
    const u = new URL(p, "http://x");
    const k = apiKey(u.pathname, u.search);
    if (manifest[k]) return JSON.parse(fs.readFileSync(path.join(OUT, "demo-data", manifest[k]), "utf8")).body;
    const res = await get(p);
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "not_json" };
    }
    const file = `${String(++n).padStart(4, "0")}.json`;
    fs.writeFileSync(path.join(OUT, "demo-data", file), JSON.stringify({ status: res.status, body }));
    manifest[k] = file;
    return body;
  }

  const fixed = [
    "/api/dashboard",
    "/api/dashboard/upcoming",
    "/api/accounts",
    "/api/accounts/overview",
    "/api/recurring",
    "/api/forecast",
    "/api/goals",
    "/api/categories",
    "/api/categories/admin",
    "/api/tags",
    "/api/tags/admin",
    "/api/targets",
    "/api/rules",
    "/api/insights",
    "/api/insights/summary",
    "/api/sync/status",
    "/api/sync/runs?limit=20",
    "/api/sync/schedule",
    "/api/settings/currency",
    "/api/settings/notifications",
    "/api/settings/ai",
    "/api/connections",
    "/api/about",
    "/api/year",
    "/api/networth",
  ];
  for (const p of fixed) await snapshot(p);

  for (const range of ["1M", "3M", "6M", "1Y", "ALL"]) await snapshot(`/api/networth?range=${range}`);

  // Spending: the last 12 months (the month picker), and the default view.
  const now = new Date();
  await snapshot("/api/spending");
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    await snapshot(`/api/spending?month=${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  // Custom ranges the preset buttons produce (computed from the visitor's clock, so these only match on build day).
  const ymd = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (k) => ymd(new Date(now.getTime() - k * 86_400_000));
  for (const k of [29, 89, 364]) await snapshot(`/api/spending?from=${daysAgo(k)}&to=${ymd(now)}`);

  const year = await snapshot("/api/year");
  for (let y = year.year; y >= year.year - 4; y--) await snapshot(`/api/year?year=${y}`);

  // Transactions: the first pages of the register, newest first.
  async function chain(extra, pages) {
    let cursor = null;
    for (let i = 0; i < pages; i++) {
      const page = await snapshot(
        `/api/transactions?${extra}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  }
  await chain("", 5);

  const accounts = (await snapshot("/api/accounts")).accounts ?? (await snapshot("/api/accounts"));
  const accountIds = (Array.isArray(accounts) ? accounts : []).map((a) => a.id).filter(Boolean);
  for (const id of accountIds) {
    const enc = encodeURIComponent(id);
    await snapshot(`/api/accounts/${enc}`);
    await snapshot(`/api/accounts/${enc}/holdings`);
    await chain(`account=${enc}&`, 2);
  }

  // ---- pages ---------------------------------------------------------------------------------------------------
  const settingsDir = path.join(root, "src/app/(app)/settings");
  const settingsPages = fs
    .readdirSync(settingsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(settingsDir, d.name, "page.tsx")))
    .map((d) => `/settings/${d.name}`);
  const pages = [
    "/",
    "/spending",
    "/accounts",
    "/transactions",
    "/insights",
    "/forecast",
    "/goals",
    "/year",
    "/rules",
    "/settings",
    ...settingsPages,
    ...accountIds.map((id) => `/accounts/${encodeURIComponent(id)}`),
  ];

  const inject = `<script>window.__SB_DEMO_BASE=${JSON.stringify(BASE)}</script><script src="${BASE}/demo-shim.js"></script>`;
  for (const p of pages) {
    // With a base path, "/" is served at "/<base>" and "/<base>/" is only a redirect to it.
    const res = await get(p === "/" ? "" : p);
    const dir = p === "/" ? OUT : path.join(OUT, ...p.split("/").filter(Boolean).map(decodeURIComponent));
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // e.g. /settings sends you on to its first sub-page.
      const to = new URL(res.headers.get("location"), ORIGIN);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "index.html"),
        `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to.pathname}">`,
      );
      console.log(`redirect ${p} -> ${to.pathname}`);
      continue;
    }
    if (!res.ok) {
      console.warn(`skip ${p}: ${res.status}`);
      continue;
    }
    const html = (await res.text()).replace(/<head>/i, (m) => `${m}${inject}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html);
    console.log(`page ${p}`);
  }

  // ---- assets --------------------------------------------------------------------------------------------------
  fs.writeFileSync(path.join(OUT, "demo-data", "manifest.json"), JSON.stringify(manifest));
  fs.copyFileSync(path.join(root, "demo/shim.js"), path.join(OUT, "demo-shim.js"));
  fs.cpSync(path.join(root, ".next/static"), path.join(OUT, "_next/static"), { recursive: true });
  for (const asset of [
    "/icon.svg",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icons/apple-touch-icon.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/maskable-512.png",
  ]) {
    const res = await get(asset);
    if (!res.ok) continue;
    const file = path.join(OUT, asset);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
  fs.writeFileSync(
    path.join(OUT, "404.html"),
    `<!doctype html><meta charset="utf-8"><title>Not in the demo</title><meta http-equiv="refresh" content="3;url=${BASE}/"><body style="font:16px system-ui;padding:2rem"><p>That page isn't part of the demo. Taking you to the dashboard...</p><p><a href="${BASE}/">Go now</a></p>`,
  );
  console.log(`\nDemo written to ${OUT}: ${pages.length} pages, ${n} saved API responses.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    stop();
  });
