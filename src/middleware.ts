import { NextResponse, type NextRequest } from "next/server";
import { isValidSessionCookie, SESSION_COOKIE } from "@/lib/auth/session-options";

/** Reachable without a session. `/api/setup/password` only works while no password exists. */
const PUBLIC_PAGES = ["/login", "/setup"];
const PUBLIC_API = ["/api/health", "/api/auth/login", "/api/setup/password"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_API.includes(pathname)) return true;
  return PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (await isValidSessionCookie(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)"],
};
