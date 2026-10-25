import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnthropicClient } from "@/lib/llm/anthropic";

// A local stand-in for the Messages API, speaking its streaming event format.
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const message = (stop: string | null) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  content: [],
  model: "m",
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

function textReply(text: string, stop = "end_turn") {
  return (
    ev("message_start", { message: message(null) }) +
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
    ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 3 } }) +
    ev("message_stop", {})
  );
}
function toolReply(name: string, input: object) {
  return (
    ev("message_start", { message: message(null) }) +
    ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "toolu_1", name, input: {} } }) +
    ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) +
    ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } }) +
    ev("message_stop", {})
  );
}

let server: Server;
let baseUrl: string;
let bodies: Array<{
  model: string;
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: unknown[];
}> = [];
let respond: (n: number) => { status?: number; body: string } = () => ({ body: textReply("hi") });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      const { status = 200, body } = respond(bodies.length);
      res.writeHead(status, { "content-type": status === 200 ? "text/event-stream" : "application/json" }).end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const client = () => createAnthropicClient({ apiKey: "sk-ant-test", model: "claude-sonnet-5-5", baseUrl });

describe("Anthropic client", () => {
  it("streams text and sends the system prompt, history and user message", async () => {
    bodies = [];
    respond = () => ({ body: textReply("Hello there") });
    const seen: string[] = [];
    const text = await client().generate({
      system: "sys",
      user: "now",
      history: [
        { role: "user", content: "before" },
        { role: "assistant", content: "ok" },
      ],
      onText: (d) => seen.push(d),
    });
    expect(text).toBe("Hello there");
    expect(seen.join("")).toBe("Hello there");
    expect(bodies[0]).toMatchObject({ model: "claude-sonnet-5-5", system: "sys" });
    expect(bodies[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(bodies[0].tools).toBeUndefined();
  });

  it("runs a tool and continues with its result", async () => {
    bodies = [];
    respond = (n) => ({ body: n === 1 ? toolReply("get_category_totals", { month: "2026-10" }) : textReply("Done.") });
    const calls: unknown[] = [];
    const text = await client().generate({
      system: "s",
      user: "u",
      tools: [
        {
          name: "get_category_totals",
          description: "d",
          inputSchema: { type: "object", properties: { month: { type: "string" } } },
        },
      ],
      runTool: (name, input) => (calls.push([name, input]), '{"ok":true}'),
    });
    expect(text).toBe("Done.");
    expect(calls).toEqual([["get_category_totals", { month: "2026-10" }]]);
    const followUp = bodies[1].messages.at(-1) as {
      role: string;
      content: Array<{ type: string; tool_use_id: string; content: string }>;
    };
    expect(followUp.role).toBe("user");
    expect(followUp.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1", content: '{"ok":true}' });
  });

  it("reports a declined request", async () => {
    respond = () => ({ body: textReply("", "refusal") });
    await expect(client().generate({ system: "s", user: "u" })).rejects.toMatchObject({ kind: "declined" });
  });

  it("maps provider errors to friendly messages without leaking the key", async () => {
    for (const [status, kind] of [
      [401, "auth"],
      [429, "rate_limit"],
      [404, "bad_response"],
    ] as const) {
      respond = () => ({
        status,
        body: JSON.stringify({ type: "error", error: { type: "x", message: "sk-ant-test leaked?" } }),
      });
      const err = await client()
        .generate({ system: "s", user: "u" })
        .catch((e) => e);
      expect(err).toMatchObject({ kind });
      expect(err.message).not.toContain("sk-ant-test");
    }
  }, 30_000);
});
