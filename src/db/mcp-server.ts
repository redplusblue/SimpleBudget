/**
 * Local, read-only MCP server over stdio, so Claude Desktop / Claude Code can ask about your budget.
 * See docs/AI.md ("Ask from Claude Desktop or Claude Code (MCP)").
 *
 *   DATABASE_PATH=./data/simplebudget.db TZ=America/New_York pnpm -s mcp [--include-balances]
 *
 * Nothing but protocol messages may be written to stdout; diagnostics go to stderr.
 */
import readline from "node:readline";
import { handleMcpLine } from "../lib/mcp/server";
import { createDb, openSqliteReadOnly } from "./open";

const file = process.env.DATABASE_PATH ?? "./data/simplebudget.db";
const sqlite = openSqliteReadOnly(file);
const ctx = {
  db: createDb(sqlite),
  timeZone: process.env.TZ ?? "UTC",
  includeBalances: process.argv.includes("--include-balances"),
};

process.stderr.write(`simplebudget MCP server reading ${file} (read-only)\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const out = handleMcpLine(line, ctx);
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
});
rl.on("close", () => {
  sqlite.close();
});
