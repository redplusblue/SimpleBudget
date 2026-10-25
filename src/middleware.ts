import { NextResponse, type NextRequest } from "next/server";
import { isCrossSiteMutation } from "@/lib/auth/csrf";
import { isValidSessionCookie, SESSION_COOKIE } from "@/lib/auth/session-options";

/** Reachable without a session. `/api/setup/password` only works while no password exists. */
const PUBLIC_PAGES = ["/login", "/setup"];
const PUBLIC_API = ["/api/health", "/api/auth/login", "/api/setup/password"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_API.includes(pathname)) return true;
  return PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Only meaningful over HTTPS; sent when the deployment says it is behind TLS. */
function withHsts(res: NextResponse): NextResponse {
  if (process.env.COOKIE_SECURE === "true")
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isCrossSiteMutation(request.method, request.headers, request.nextUrl.host)) {
    return withHsts(NextResponse.json({ error: "forbidden", message: "Cross-site request refused" }, { status: 403 }));
  }
  if (isPublic(pathname)) return withHsts(NextResponse.next());

  if (await isValidSessionCookie(request.cookies.get(SESSION_COOKIE)?.value)) return withHsts(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/).*)"],
};
