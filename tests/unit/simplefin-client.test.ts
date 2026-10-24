import { describe, expect, it, vi } from "vitest";
import { buildAccountsRequest, fetchAccounts, SimpleFinError } from "@/lib/simplefin/client";

const ACCESS = "https://us%40er:p%3Ass@bridge.simplefin.org/simplefin";
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

describe("buildAccountsRequest", () => {
  it("moves credentials into a Basic header and builds the query", () => {
    const { url, authorization } = buildAccountsRequest({
      accessUrl: ACCESS + "/",
      start: 100.9,
      end: 200,
      pending: true,
      balancesOnly: true,
      accountIds: ["a", "b"],
    });
    const u = new URL(url);
    expect(u.username).toBe("");
    expect(u.origin + u.pathname).toBe("https://bridge.simplefin.org/simplefin/accounts");
    expect(u.searchParams.get("start-date")).toBe("100");
    expect(u.searchParams.get("end-date")).toBe("200");
    expect(u.searchParams.get("pending")).toBe("1");
    expect(u.searchParams.get("balances-only")).toBe("1");
    expect(u.searchParams.getAll("account")).toEqual(["a", "b"]);
    expect(Buffer.from(authorization.replace("Basic ", ""), "base64").toString()).toBe("us@er:p:ss");
  });

  it("omits optional params", () => {
    const { url } = buildAccountsRequest({ accessUrl: ACCESS });
    expect(new URL(url).search).toBe("");
  });
});

describe("fetchAccounts", () => {
  it("validates and returns the response, defaulting missing arrays", async () => {
    const f = vi.fn(async () => ok({ accounts: [] }));
    const res = await fetchAccounts({ accessUrl: ACCESS, fetchImpl: f as unknown as typeof fetch });
    expect(res).toMatchObject({ errors: [], accounts: [] });
  });

  it("counts every attempt and retries 5xx with exponential backoff, then succeeds", async () => {
    sleep.mockClear();
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok({ accounts: [] }));
    const onRequest = vi.fn();
    await fetchAccounts({ accessUrl: ACCESS, fetchImpl: f as unknown as typeof fetch, sleep, onRequest });
    expect(onRequest).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it("gives up after 2 retries", async () => {
    const f = vi.fn(async () => new Response("", { status: 502 }));
    await expect(
      fetchAccounts({ accessUrl: ACCESS, fetchImpl: f as unknown as typeof fetch, sleep }),
    ).rejects.toMatchObject({ code: "server" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])("does not retry %d and reports revoked access", async (status) => {
    const f = vi.fn(async () => new Response("", { status }));
    const err = await fetchAccounts({ accessUrl: ACCESS, fetchImpl: f as unknown as typeof fetch, sleep }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(SimpleFinError);
    expect(err).toMatchObject({ code: "revoked", message: "SimpleFIN access revoked — reconnect." });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does not retry other 4xx or 429", async () => {
    const f = vi.fn(async () => new Response("", { status: 429 }));
    await expect(
      fetchAccounts({ accessUrl: ACCESS, fetchImpl: f as unknown as typeof fetch, sleep }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    const g = vi.fn(async () => new Response("", { status: 400 }));
    await expect(
      fetchAccounts({ accessUrl: ACCESS, fetchImpl: g as unknown as typeof fetch, sleep }),
    ).rejects.toMatchObject({ code: "bad_response" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed bodies without leaking credentials", async () => {
    for (const body of [
      "not json",
      JSON.stringify({ accounts: "nope" }),
      JSON.stringify({ accounts: [{ id: "x" }] }),
    ]) {
      const f = vi.fn(async () => new Response(body, { status: 200 }));
      const err = await fetchAccounts({ accessUrl: ACCESS, fetchImpl: f as unknown as typeof fetch, sleep }).catch(
        (e) => e,
      );
      expect(err).toMatchObject({ code: "bad_response" });
      expect(String(err.message)).not.toMatch(/p:ss|p%3Ass/);
    }
  });
});
