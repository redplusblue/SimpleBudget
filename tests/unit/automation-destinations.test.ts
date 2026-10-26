import { describe, expect, it } from "vitest";
import { notifyDestinations } from "@/db/schema";
import {
  createDestination,
  DestinationError,
  deleteDestination,
  listDestinations,
  sendTo,
  updateDestination,
} from "@/lib/automations/destinations";
import { freshDb } from "../helpers/db";

const HOOK = "https://discord.com/api/webhooks/123/secret-token-xyz";
const NTFY = "https://ntfy.example.com/very-secret-topic";

const fakeFetch = (status = 200) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("ok", { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
};

describe("destinations", () => {
  it("lists only name, kind and host, never the address or token", () => {
    const db = freshDb();
    createDestination(db, { name: "Phone", kind: "ntfy", url: NTFY, token: "tok-super-secret" });
    createDestination(db, { name: "Server", kind: "discord", url: HOOK });
    const list = listDestinations(db);
    expect(list).toEqual([
      { id: 1, name: "Phone", kind: "ntfy", host: "ntfy.example.com" },
      { id: 2, name: "Server", kind: "discord", host: "discord.com" },
    ]);
    const wire = JSON.stringify(list);
    for (const secret of ["very-secret-topic", "tok-super-secret", "secret-token-xyz"])
      expect(wire).not.toContain(secret);
    // and the database holds them encrypted
    const stored = JSON.stringify(db.select().from(notifyDestinations).all());
    for (const secret of ["very-secret-topic", "tok-super-secret", "secret-token-xyz"])
      expect(stored).not.toContain(secret);
  });

  it("validates names, addresses and the Discord shape", () => {
    const db = freshDb();
    expect(() => createDestination(db, { name: " ", kind: "ntfy", url: NTFY })).toThrow();
    expect(() => createDestination(db, { name: "x", kind: "ntfy", url: "ftp://nope" })).toThrow(/full address/);
    expect(() => createDestination(db, { name: "x", kind: "discord", url: "https://example.com/h" })).toThrow(
      /Discord webhook/,
    );
    expect(() => createDestination(db, { name: "x", kind: "ntfy", url: NTFY, extra: 1 })).toThrow();
  });

  it("updates with write-only address and token, and re-checks the kind", () => {
    const db = freshDb();
    const d = createDestination(db, { name: "Phone", kind: "webhook", url: "https://a.example/h", token: "t1-secret" });
    expect(updateDestination(db, d.id, { name: "Pager" }).name).toBe("Pager");
    expect(updateDestination(db, d.id, { url: "https://b.example/h" }).host).toBe("b.example");
    expect(() => updateDestination(db, d.id, { kind: "discord" })).toThrow(DestinationError); // saved address isn't Discord
    expect(updateDestination(db, d.id, { kind: "discord", url: HOOK }).kind).toBe("discord");
    expect(db.select().from(notifyDestinations).get()!.tokenEnc).toBeNull(); // Discord needs no token
    expect(() => updateDestination(db, d.id, {})).toThrow(/Nothing to change/);
    expect(() => updateDestination(db, 99, { name: "x" })).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("deletes, and sendTo reaches the right address without throwing", async () => {
    const db = freshDb();
    const d = createDestination(db, { name: "Server", kind: "discord", url: HOOK });
    const { calls, impl } = fakeFetch();
    expect(await sendTo(db, d.id, { event: "test", title: "t", message: "m" }, impl)).toEqual({
      ok: true,
      status: 200,
    });
    expect(calls[0].url).toBe(HOOK);
    expect((await sendTo(db, d.id, { event: "test", title: "t", message: "m" }, fakeFetch(500).impl)).ok).toBe(false);
    deleteDestination(db, d.id);
    expect(await sendTo(db, d.id, { event: "test", title: "t", message: "m" }, impl)).toEqual({
      ok: false,
      status: null,
    });
    expect(() => deleteDestination(db, d.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});
