import type { DbLike } from "@/db/open";
import { currentMonth } from "@/lib/finance/dates";
import { buildAiContext } from "@/lib/llm/context";
import { LLM_TOOLS, createToolRunner } from "@/lib/llm/tools";
import type { LlmTool } from "@/lib/llm/types";

// A minimal Model Context Protocol server (JSON-RPC 2.0, one message per line over stdio) that exposes the same
// read-only tools the in-app assistant uses, so Claude Desktop, Claude Code or any MCP client can query the budget.
// Hand-rolled on purpose: the protocol surface we need is four methods, and it avoids a dependency (DECISIONS.md).

export const SERVER_INFO = { name: "simplebudget", version: "1" };
const FALLBACK_PROTOCOL = "2025-06-18";

const OVERVIEW_TOOL: LlmTool = {
  name: "get_overview",
  description:
    "Start here. This month so far: totals, categories against last month and the 3-month average, top merchants and the app's own spending insights.",
  inputSchema: { type: "object", properties: {} },
};

export const MCP_TOOLS: LlmTool[] = [OVERVIEW_TOOL, ...LLM_TOOLS];

export interface McpContext {
  db: DbLike;
  timeZone: string;
  includeBalances: boolean;
  now?: () => number;
}

interface Request {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const reply = (id: Request["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Request["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** Handles one line of input. Returns the JSON response, or null for notifications (which get no answer). */
export function handleMcpLine(line: string, ctx: McpContext): object | null {
  let msg: Request;
  try {
    msg = JSON.parse(line) as Request;
  } catch {
    return fail(null, -32700, "Parse error");
  }
  if (typeof msg !== "object" || msg === null || typeof msg.method !== "string") {
    return fail(null, -32600, "Invalid request");
  }
  const isNotification = msg.id === undefined;

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return reply(msg.id, {
        protocolVersion: typeof asked === "string" ? asked : FALLBACK_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "Read-only access to a personal budget. Call get_overview first, then the other tools for detail. Amounts are formatted dollars; negative means money out.",
      });
    }
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, {
        tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string" || !MCP_TOOLS.some((t) => t.name === name)) {
        return fail(msg.id, -32602, `Unknown tool: ${String(name)}`);
      }
      const now = (ctx.now ?? (() => Math.floor(Date.now() / 1000)))();
      try {
        const text =
          name === "get_overview"
            ? JSON.stringify(
                buildAiContext(ctx.db, {
                  now,
                  timeZone: ctx.timeZone,
                  month: currentMonth(now, ctx.timeZone),
                  includeBalances: ctx.includeBalances,
                }),
              )
            : createToolRunner(ctx.db, now, ctx.timeZone, ctx.includeBalances)(name, msg.params?.arguments ?? {});
        return reply(msg.id, { content: [{ type: "text", text }] });
      } catch (e) {
        // Tool failures are reported to the model as results, so it can correct its arguments.
        return reply(msg.id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : "The tool failed." }],
          isError: true,
        });
      }
    }
    default:
      return isNotification ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
