import { describe, expect, it, vi } from "vitest";
import { claimSetupToken, decodeSetupToken, SimpleFinError } from "@/lib/simplefin/client";

const CLAIM = "https://bridge.simplefin.org/simplefin/claim/abc123";
const TOKEN = Buffer.from(CLAIM).toString("base64");
const ACCESS = "https://user:pass@bridge.simplefin.org/simplefin";

const reply = (status: number, body = "") => vi.fn(async () => new Response(body, { status }));

describe("decodeSetupToken", () => {
  it("decodes standard, URL-safe and whitespace-wrapped tokens", () => {
    expect(decodeSetupToken(TOKEN)).toBe(CLAIM);
    expect(decodeSetupToken(`  ${TOKEN.slice(0, 10)}\n${TOKEN.slice(10)} `)).toBe(CLAIM);
    const urlSafe = TOKEN.replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodeSetupToken(urlSafe)).toBe(CLAIM);
  });

  it.each([
    "",
    "not a token!",
    Buffer.from("not a url").toString("base64"),
    Buffer.from("http://insecure.example/claim").toString("base64"),
    Buffer.from("https://u:p@host/claim").toString("base64"),
  ])("rejects %j", (t) => {
    expect(() => decodeSetupToken(t)).toThrow(SimpleFinError);
  });
});

describe("claimSetupToken", () => {
  it("POSTs to the claim URL and returns the access URL", async () => {
    const f = reply(200, `${ACCESS}\n`);
    await expect(claimSetupToken(TOKEN, { fetchImpl: f as unknown as typeof fetch })).resolves.toBe(ACCESS);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CLAIM);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("maps 403 to already_claimed", async () => {
    await expect(claimSetupToken(TOKEN, { fetchImpl: reply(403) as unknown as typeof fetch })).rejects.toMatchObject({
      code: "already_claimed",
    });
  });

  it("maps other failures", async () => {
    await expect(claimSetupToken(TOKEN, { fetchImpl: reply(404) as unknown as typeof fetch })).rejects.toMatchObject({
      code: "invalid_token",
    });
    await expect(claimSetupToken(TOKEN, { fetchImpl: reply(500) as unknown as typeof fetch })).rejects.toMatchObject({
      code: "server",
    });
    const boom = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(claimSetupToken(TOKEN, { fetchImpl: boom as unknown as typeof fetch })).rejects.toMatchObject({
      code: "network",
    });
  });

  it("rejects a response that isn't an https access URL with credentials", async () => {
    for (const body of ["", "garbage", "https://bridge.simplefin.org/simplefin", "http://u:p@host/x"]) {
      await expect(
        claimSetupToken(TOKEN, { fetchImpl: reply(200, body) as unknown as typeof fetch }),
      ).rejects.toMatchObject({
        code: "bad_response",
      });
    }
  });

  it("never puts credentials in error messages", async () => {
    try {
      await claimSetupToken(TOKEN, { fetchImpl: reply(200, "http://u:secretpw@host/x") as unknown as typeof fetch });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("secretpw");
    }
  });
});
