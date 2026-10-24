import "server-only";
import argon2 from "argon2";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { RateLimiter } from "@/lib/rate-limit";
import { sessionOptions, type SessionData } from "./session-options";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

async function session() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function isAuthenticated(): Promise<boolean> {
  return (await session()).authed === true;
}

export async function createSession(): Promise<void> {
  const s = await session();
  s.authed = true;
  await s.save();
}

export async function destroySession(): Promise<void> {
  (await session()).destroy();
}

/** Defense in depth behind the middleware: returns a 401 response when there is no session. */
export async function requireApiAuth(): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

const FIFTEEN_MIN = 15 * 60 * 1000;

const globalForLimit = globalThis as unknown as { __sbLoginLimiters?: { perIp: RateLimiter; global: RateLimiter } };

/**
 * 5 failed logins per 15 minutes per client IP. Behind no proxy the IP header can be
 * spoofed, so a looser global cap applies across all clients as well.
 */
export function loginLimiters() {
  return (globalForLimit.__sbLoginLimiters ??= {
    perIp: new RateLimiter({ max: 5, windowMs: FIFTEEN_MIN }),
    global: new RateLimiter({ max: 30, windowMs: FIFTEEN_MIN }),
  });
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip")?.trim() || "unknown";
}
