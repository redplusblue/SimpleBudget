import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { createDb, openSqlite } from "@/db/open";
import { settings } from "@/db/schema";
import { addConnection } from "@/lib/connections";
import { zonedDayStart } from "@/lib/finance/dates";
import { getNotifyConfig, getNotifyTarget, NotifyConfigError, updateNotifyConfig } from "@/lib/notify/config";
import {
  buildSyncNotifications,
  FAILURE_COOLDOWN_SECONDS,
  MAX_LARGE_MESSAGES,
  notifyAfterSync,
} from "@/lib/notify/events";
import { sendNotification } from "@/lib/notify/send";
import { runSync } from "@/lib/simplefin/sync";
import { addAccount, addTxn, freshDb } from "../helpers/db";
import { ACCESS_URL, mockBank, NOW as SYNC_NOW } from "../helpers/simplefin-mock";

const TZ = "UTC";
const NOW = zonedDayStart("2026-10-24", TZ) + 12 * 3600;
const URL_ = "https://ntfy.example.com/my-secret-topic-123";

const on = (db: ReturnType<typeof freshDb>, extra: object = {}) =>
  updateNotifyConfig(db, { url: URL_, enabled: true, ...extra });
const fakeFetch = () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
};

describe("configuration", () => {
  it("keeps the address and token encrypted and only reports the host", () => {
    const db = freshDb();
    expect(getNotifyConfig(db)).toMatchObject({
      enabled: false,
      hasUrl: false,
      kind: "ntfy",
      largeCents: 50_000,
      onLarge: true,
      onFailure: true,
      details: false,
    });
    const cfg = updateNotifyConfig(db, { url: URL_, token: "tk_secret_value", enabled: true });
    expect(cfg).toMatchObject({ enabled: true, hasUrl: true, host: "ntfy.example.com", hasToken: true });
    expect(JSON.stringify(cfg)).not.toContain("my-secret-topic");
    expect(JSON.stringify(cfg)).not.toContain("tk_secret");
    const stored = db.select().from(settings).where(eq(settings.key, "notify:url")).get()!.value;
    expect(stored).not.toContain("ntfy.example.com");
    expect(getNotifyTarget(db)).toEqual({ kind: "ntfy", url: URL_, token: "tk_secret_value" });
    updateNotifyConfig(db, { largeCents: 100_000 });
    expect(getNotifyTarget(db)?.url).toBe(URL_); // other changes keep it
    expect(updateNotifyConfig(db, { url: null, token: null, enabled: false })).toMatchObject({
      hasUrl: false,
      hasToken: false,
    });
    expect(getNotifyTarget(db)).toBeNull();
  });

  it("validates and refuses to turn on without a destination", () => {
    const db = freshDb();
    expect(() => updateNotifyConfig(db, { enabled: true })).toThrow(NotifyConfigError);
    for (const bad of [{ url: "ftp://x" }, { url: "not a url" }, { kind: "sms" }, { largeCents: 0 }, { surprise: 1 }])
      expect(() => updateNotifyConfig(db, bad)).toThrow();
  });
});

describe("sendNotification", () => {
  it("posts plain text with headers to ntfy, with the token as a bearer", async () => {
    const f = fakeFetch();
    const res = await sendNotification(
      { kind: "ntfy", url: URL_, token: "tk" },
      { event: "sync_failed", title: "Sync failed – check it", message: "Boom", priority: "high" },
      f.impl,
    );
    expect(res).toEqual({ ok: true, status: 200 });
    const { url, init } = f.calls[0];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("Boom");
    expect(init.headers).toMatchObject({
      authorization: "Bearer tk",
      priority: "high",
      tags: "warning",
      title: "Sync failed ? check it",
    });
    expect(init.redirect).toBe("error");
  });

  it("posts a JSON document to a generic webhook", async () => {
    const f = fakeFetch();
    await sendNotification(
      { kind: "webhook", url: "https://hooks.example.com/x", token: null },
      { event: "large_transaction", title: "T", message: "M" },
      f.impl,
    );
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      app: "SimpleBudget",
      event: "large_transaction",
      title: "T",
      message: "M",
      priority: "default",
    });
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("reports failure instead of throwing", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(
      await sendNotification(
        { kind: "ntfy", url: URL_, token: null },
        { event: "test", title: "t", message: "m" },
        down,
      ),
    ).toEqual({ ok: false, status: null });
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(
      await sendNotification(
        { kind: "ntfy", url: URL_, token: null },
        { event: "test", title: "t", message: "m" },
        bad,
      ),
    ).toEqual({ ok: false, status: 500 });
  });
});

describe("what a sync announces", () => {
  function withTxns() {
    const db = freshDb();
    addAccount(db, "A", { displayName: "Everyday" });
    const t = (cents: number, description: string, over: object = {}) =>
      addTxn(db, "A", { posted: NOW - 3600, amountCents: cents, description, ...over }).id;
    return {
      db,
      small: t(-4_500, "COFFEE"),
      big: t(-74_218, "AMAZON MKTP"),
      deposit: t(250_000, "PAYROLL"),
      transfer: t(-100_000, "TO SAVINGS", { isTransfer: true }),
      excluded: t(-90_000, "REFUNDED", { isExcluded: true }),
    };
  }

  it("announces large purchases and deposits, in generic words unless details are allowed", () => {
    const c = withTxns();
    on(c.db);
    const out = buildSyncNotifications(
      c.db,
      { status: "ok", errors: [], newIds: [c.small, c.big, c.deposit, c.transfer, c.excluded] },
      NOW,
      TZ,
    );
    expect(out.map((n) => [n.title, n.message])).toEqual([
      ["Large deposit", "A large amount was received: $2,500.00. Open SimpleBudget for details."],
      ["Large purchase", "A large amount was spent: $742.18. Open SimpleBudget for details."],
    ]);
    expect(JSON.stringify(out)).not.toMatch(/AMAZON|PAYROLL|Everyday/);

    updateNotifyConfig(c.db, { details: true });
    const detailed = buildSyncNotifications(c.db, { status: "ok", errors: [], newIds: [c.big, c.deposit] }, NOW, TZ);
    expect(detailed.map((n) => n.message)).toEqual([
      "$2,500.00 from PAYROLL on 2026-10-24 (Everyday)",
      "$742.18 at AMAZON MKTP on 2026-10-24 (Everyday)",
    ]);
  });

  it("respects the threshold and the on/off choices, and only looks at this sync's new rows", () => {
    const c = withTxns();
    on(c.db, { largeCents: 100_000 });
    expect(buildSyncNotifications(c.db, { status: "ok", errors: [], newIds: [c.big, c.small] }, NOW, TZ)).toEqual([]);
    updateNotifyConfig(c.db, { largeCents: 50_000 });
    expect(buildSyncNotifications(c.db, { status: "ok", errors: [], newIds: [c.small] }, NOW, TZ)).toEqual([]); // the big one wasn't new
    updateNotifyConfig(c.db, { onLarge: false });
    expect(buildSyncNotifications(c.db, { status: "ok", errors: [], newIds: [c.big] }, NOW, TZ)).toEqual([]);
  });

  it("caps individual messages and summarizes the rest", () => {
    const db = freshDb();
    addAccount(db, "A");
    const ids = Array.from(
      { length: 8 },
      (_, i) => addTxn(db, "A", { posted: NOW, amountCents: -60_000 - i, description: `BIG ${i}` }).id,
    );
    on(db);
    const out = buildSyncNotifications(db, { status: "ok", errors: [], newIds: ids }, NOW, TZ);
    expect(out).toHaveLength(MAX_LARGE_MESSAGES + 1);
    expect(out.at(-1)).toMatchObject({
      title: "More large transactions",
      message: "3 more transactions of $500.00 or more were added.",
    });
  });

  it("announces a failed sync once per cooldown", () => {
    const db = freshDb();
    on(db);
    const failed = { status: "error" as const, errors: ["SimpleFIN rejected the access token."], newIds: [] };
    const first = buildSyncNotifications(db, failed, NOW, TZ);
    expect(first).toEqual([
      {
        event: "sync_failed",
        priority: "high",
        title: "SimpleBudget sync failed",
        message: "SimpleFIN rejected the access token.",
      },
    ]);
    expect(buildSyncNotifications(db, failed, NOW + 60, TZ)).toEqual([]); // still failing, already told
    expect(buildSyncNotifications(db, failed, NOW + FAILURE_COOLDOWN_SECONDS + 1, TZ)).toHaveLength(1);
    expect(
      buildSyncNotifications(
        db,
        { status: "partial", errors: ["Daily limit"], newIds: [] },
        NOW + 2 * FAILURE_COOLDOWN_SECONDS + 5,
        TZ,
      )[0].title,
    ).toBe("SimpleBudget sync finished with problems");
    expect(
      buildSyncNotifications(db, { status: "ok", errors: [], newIds: [] }, NOW + 9 * FAILURE_COOLDOWN_SECONDS, TZ),
    ).toEqual([]);
    updateNotifyConfig(db, { onFailure: false });
    expect(buildSyncNotifications(db, failed, NOW + 20 * FAILURE_COOLDOWN_SECONDS, TZ)).toEqual([]);
  });
});

describe("notifyAfterSync", () => {
  it("does nothing when notifications are off", async () => {
    const db = freshDb();
    const f = fakeFetch();
    expect(await notifyAfterSync(db, { status: "error", errors: ["x"], newIds: [] }, NOW, TZ, f.impl)).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("sends each message and survives a failing destination", async () => {
    const db = freshDb();
    on(db);
    const f = fakeFetch();
    expect(await notifyAfterSync(db, { status: "error", errors: ["x"], newIds: [] }, NOW, TZ, f.impl)).toBe(1);
    expect(f.calls).toHaveLength(1);
    const broken = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(
      await notifyAfterSync(
        db,
        { status: "error", errors: ["x"], newIds: [] },
        NOW + FAILURE_COOLDOWN_SECONDS + 1,
        TZ,
        broken,
      ),
    ).toBe(0);
  });
});

describe("a real sync", () => {
  it("tells you when the bank is unreachable, using the configured destination", async () => {
    const db = createDb(openSqlite(":memory:"));
    runMigrations(db, path.resolve(import.meta.dirname, "../../drizzle"));
    addConnection(db, ACCESS_URL);
    on(db);
    const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const bank = mockBank();
      bank.status = 403;
      await runSync(db, {
        mode: "backfill",
        days: 30,
        trigger: "scheduled",
        now: SYNC_NOW,
        fetchImpl: bank.fetch,
        sleep: async () => {},
        timeZone: "UTC",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(URL_);
      expect(init.headers).toMatchObject({ title: "SimpleBudget sync failed" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Discord", () => {
  const hook = "https://discord.com/api/webhooks/123456/abcDEF-token";

  it("posts an embed, truncated, with a color by severity and no auth header", async () => {
    const { calls, impl } = fakeFetch();
    const target = { kind: "discord" as const, url: hook, token: "should-not-be-sent" };
    await sendNotification(
      target,
      { event: "automation", title: "T".repeat(300), message: "M".repeat(5000), severity: "good" },
      impl,
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.username).toBe("SimpleBudget");
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toHaveLength(256);
    expect(body.embeds[0].description).toHaveLength(4000);
    expect(body.embeds[0].color).toBe(0x30a46c);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("colors warnings and high priority red, everything else purple", async () => {
    const color = async (n: object) => {
      const { calls, impl } = fakeFetch();
      await sendNotification(
        { kind: "discord", url: hook, token: null },
        { event: "test", title: "t", message: "m", ...n },
        impl,
      );
      return JSON.parse(String(calls[0].init.body)).embeds[0].color;
    };
    expect(await color({ severity: "warn" })).toBe(0xe5484d);
    expect(await color({ priority: "high" })).toBe(0xe5484d);
    expect(await color({})).toBe(0x6e56cf);
  });

  it("only accepts Discord webhook addresses for the discord kind", () => {
    const db = freshDb();
    expect(() => updateNotifyConfig(db, { kind: "discord", url: "https://example.com/hook" })).toThrow(
      /doesn't look like a Discord webhook URL/,
    );
    expect(updateNotifyConfig(db, { kind: "discord", url: hook, enabled: true })).toMatchObject({
      kind: "discord",
      host: "discord.com",
    });
    expect(updateNotifyConfig(db, { url: "https://discordapp.com/api/webhooks/1/x" }).host).toBe("discordapp.com");
    // switching an existing, non-Discord address to Discord is refused too
    const other = freshDb();
    updateNotifyConfig(other, { url: URL_ });
    expect(() => updateNotifyConfig(other, { kind: "discord" })).toThrow(NotifyConfigError);
  });

  it("leaves ntfy and webhook bodies unchanged", async () => {
    const { calls, impl } = fakeFetch();
    await sendNotification(
      { kind: "webhook", url: "https://x.example/h", token: "tok" },
      { event: "test", title: "t", message: "m" },
      impl,
    );
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ app: "SimpleBudget", event: "test" });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
});
