import { unsealData, type SessionOptions } from "iron-session";

// Edge-safe: imported by middleware, so no node-only or server-only modules here.

export const SESSION_COOKIE = "sb_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionData {
  authed?: boolean;
}

export function sessionOptions(): SessionOptions {
  return {
    password: process.env.APP_SECRET ?? "",
    cookieName: SESSION_COOKIE,
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      // Only mark Secure when served over HTTPS, otherwise browsers drop the cookie.
      secure: process.env.COOKIE_SECURE === "true",
      path: "/",
    },
  };
}

/** Whether a raw cookie value is a valid, unexpired, authenticated session. */
export async function isValidSessionCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const { password, ttl } = sessionOptions();
  if (typeof password !== "string" || password.length < 32) return false;
  try {
    const data = await unsealData<SessionData>(value, { password, ttl });
    return data.authed === true;
  } catch {
    return false;
  }
}
