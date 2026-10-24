import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("blocks after max failures and reports retry time", () => {
    let t = 0;
    const rl = new RateLimiter({ max: 5, windowMs: 900_000, now: () => t });
    for (let i = 0; i < 5; i++) {
      expect(rl.check("ip").allowed).toBe(true);
      rl.fail("ip");
      t += 1000;
    }
    const res = rl.check("ip");
    expect(res.allowed).toBe(false);
    expect(res.retryAfterMs).toBe(900_000 - 5000);
  });

  it("recovers once failures leave the window", () => {
    let t = 0;
    const rl = new RateLimiter({ max: 2, windowMs: 1000, now: () => t });
    rl.fail("a");
    rl.fail("a");
    expect(rl.check("a").allowed).toBe(false);
    t = 1001;
    expect(rl.check("a").allowed).toBe(true);
  });

  it("tracks keys independently and supports reset", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 1000 });
    rl.fail("a");
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
    rl.reset("a");
    expect(rl.check("a").allowed).toBe(true);
  });

  it("bounds memory", () => {
    const rl = new RateLimiter({ max: 1, windowMs: 1000, maxKeys: 3 });
    for (let i = 0; i < 10; i++) rl.fail(`k${i}`);
    expect(rl.check("k0").allowed).toBe(true);
    expect(rl.check("k9").allowed).toBe(false);
  });
});
