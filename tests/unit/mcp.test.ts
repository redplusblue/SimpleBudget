import { describe, expect, it } from "vitest";
import { zonedDayStart } from "@/lib/finance/dates";
import { buildExport } from "@/lib/llm/export";
import { handleMcpLine, MCP_TOOLS } from "@/lib/mcp/server";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const NOW = zonedDayStart("2026-10-24", "UTC") + 12 * 3600;

function ctx() {
  const db = freshDb();
  addAccount(db, "ACT-secret-1", { displayName: "Everyday", balanceCents: 12_300 });
  addTxn(db, "ACT-secret-1", {
    posted: zonedDayStart("2026-10-05", "UTC") + 3600,
    amountCents: -4_200,
    description: "BLUE BOTTLE COFFEE #9",
    categoryId: categoryId(db, "Dining"),
    notes: "private note",
  });
  return { db, timeZone: "UTC", includeBalances: false, now: () => NOW };
}
const call = (c: ReturnType<typeof ctx>, msg: object) => handleMcpLine(JSON.stringify(msg), c) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("MCP server", () => {
  it("handshakes, lists tools, and gives notifications no reply", () => {
    const c = ctx();
    const init = call(c, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    expect(init.result.protocolVersion).toBe("2025-03-26");
    expect(init.result.capabilities).toEqual({ tools: {} });
    expect(handleMcpLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), c)).toBeNull();
    const list = call(c, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(list.result.tools[0].name).toBe("get_overview");
  });

  it("runs tools read-only and reports bad arguments as tool errors, not protocol errors", () => {
    const c = ctx();
    const overview = call(c, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_overview" } });
    const text = overview.result.content[0].text as string;
    expect(text).toContain("$42.00");
    expect(text).not.toContain("ACT-secret-1");
    expect(text).not.toContain("private note");
    expect(text).not.toContain("Everyday");

    const bad = call(c, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_year_summary", arguments: { year: "x" } },
    });
    expect(bad.result.isError).toBe(true);
    const unknown = call(c, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "drop_tables" } });
    expect(unknown.error.code).toBe(-32602);
  });

  it("rejects garbage and unknown methods", () => {
    const c = ctx();
    expect(call(c, { jsonrpc: "2.0", id: 6, method: "nope" }).error.code).toBe(-32601);
    expect((handleMcpLine("{not json", c) as any).error.code).toBe(-32700); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((handleMcpLine("42", c) as any).error.code).toBe(-32600); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe("export", () => {
  it("is one markdown document with the aggregates and no private fields", () => {
    const c = ctx();
    const md = buildExport(c.db, { now: NOW, timeZone: "UTC", includeBalances: false });
    expect(md).toContain("# SimpleBudget snapshot (2026-10)");
    expect(md).toContain("Twelve months ending 2026-10");
    expect(md).toContain("$42.00");
    for (const secret of ["ACT-secret-1", "private note", "Everyday"]) expect(md).not.toContain(secret);
  });
});
