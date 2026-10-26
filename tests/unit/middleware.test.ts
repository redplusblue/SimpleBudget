import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { sanitizeNextPath } from "@/lib/auth/next-path";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session-options";
import { middleware } from "@/middleware";

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

const seal = (data: object, ttl = SESSION_TTL_SECONDS) => sealData(data, { password: process.env.APP_SECRET!, ttl });

describe("middleware", () => {
  it.each([
    "/api/accounts",
    "/api/sync",
    "/api/connections",
    "/api/connections/1",
    "/api/setup/complete",
    "/api/auth/logout",
    "/api/sync/status",
    "/api/sync/runs",
    "/api/sync/schedule",
    "/api/accounts/abc",
    "/api/accounts/overview",
    "/api/transactions",
    "/api/transactions/1",
    "/api/categories",
    "/api/tags",
    "/api/dashboard",
    "/api/categories/admin",
    "/api/categories/1",
    "/api/categories/1/merge",
    "/api/categories/order",
    "/api/tags/admin",
    "/api/tags/1",
    "/api/rules",
    "/api/rules/1",
    "/api/rules/order",
    "/api/rules/preview",
    "/api/rules/apply",
    "/api/spending",
    "/api/insights",
    "/api/insights/summary",
    "/api/insights/ask",
    "/api/settings/ai",
    "/api/settings/ai/test",
    "/api/ai/usage",
    "/api/ai/proposals",
    "/api/ai/insights",
    "/api/ai/insights/1",
    "/api/ai/memories",
    "/api/ai/memories/1",
    "/api/ai/proposals/1/accept",
    "/api/ai/proposals/1/dismiss",
    "/api/ai/proposals/accept-all",
    "/api/ai/rule-suggestions/plan",
    "/api/ai/rule-suggestions/run",
    "/api/settings/ai/rules",
    "/api/transactions/1/splits",
    "/api/accounts/x/balance",
    "/api/accounts/x/transactions",
    "/api/transactions/1/manual",
    "/api/accounts/x/reconcile",
    "/api/export/transactions",
    "/api/export/backup",
    "/api/import/preview",
    "/api/import/commit",
    "/api/about",
    "/api/about/backup",
    "/api/dashboard/upcoming",
    "/api/goals",
    "/api/goals/1",
    "/api/forecast",
    "/api/year",
    "/api/settings/currency",
    "/api/settings/notifications",
    "/api/settings/notifications/test",
    "/api/targets",
    "/api/targets/1",
    "/api/recurring",
    "/api/networth",
  ])("returns 401 JSON for %s without a session", async (path) => {
    const res = await middleware(req(path));
    expect(res.status).toBe(401);
  });

  it("redirects pages to /login with the original path", async () => {
    const res = await middleware(req("/accounts?x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/accounts?x=1");
  });

  it("does not add ?next for the root page", async () => {
    const res = await middleware(req("/"));
    expect(new URL(res.headers.get("location")!).search).toBe("");
  });

  it.each(["/login", "/setup", "/api/health", "/api/auth/login", "/api/setup/password"])(
    "lets %s through",
    async (path) => {
      const res = await middleware(req(path));
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    },
  );

  it("accepts a valid session", async () => {
    const res = await middleware(req("/api/accounts", await seal({ authed: true })));
    expect(res.status).toBe(200);
  });

  it("rejects sessions that are unauthenticated, forged, or expired", async () => {
    expect((await middleware(req("/api/x", await seal({})))).status).toBe(401);
    expect((await middleware(req("/api/x", "Fe26.2**garbage"))).status).toBe(401);
    const shortLived = await seal({ authed: true }, 60);
    expect((await middleware(req("/api/x", shortLived))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    try {
      expect((await middleware(req("/api/x", shortLived))).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    const forged = await sealData({ authed: true }, { password: "another-secret-another-secret-123456", ttl: 60 });
    expect((await middleware(req("/api/x", forged))).status).toBe(401);
  });
});

describe("sanitizeNextPath", () => {
  it("keeps local paths", () => {
    expect(sanitizeNextPath("/accounts?x=1")).toBe("/accounts?x=1");
  });
  it.each([undefined, null, "", "https://evil.com", "//evil.com", "/\\evil.com", "evil", "/a\nb"])(
    "falls back to / for %j",
    (v) => {
      expect(sanitizeNextPath(v as string | null | undefined)).toBe("/");
    },
  );
});
