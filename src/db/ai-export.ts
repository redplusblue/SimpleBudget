/**
 * Writes a compact markdown snapshot of your budget to paste into any chat assistant. Free: calls no model.
 *
 *   pnpm -s ai:export > snapshot.md          (or --out snapshot.md)
 *   options: --month YYYY-MM  --include-balances  --out FILE
 */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { buildExport } from "../lib/llm/export";
import { createDb, openSqliteReadOnly } from "./open";

const { values } = parseArgs({
  options: {
    month: { type: "string" },
    out: { type: "string" },
    "include-balances": { type: "boolean", default: false },
  },
});
if (values.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.month)) throw new Error("--month must look like 2026-09");

const sqlite = openSqliteReadOnly(process.env.DATABASE_PATH ?? "./data/simplebudget.db");
try {
  const md = buildExport(createDb(sqlite), {
    now: Math.floor(Date.now() / 1000),
    timeZone: process.env.TZ ?? "UTC",
    month: values.month,
    includeBalances: values["include-balances"],
  });
  if (values.out) {
    fs.writeFileSync(values.out, md);
    console.error(`Wrote ${md.length} characters (~${Math.ceil(md.length / 4)} tokens) to ${values.out}`);
  } else process.stdout.write(`${md}\n`);
} finally {
  sqlite.close();
}
