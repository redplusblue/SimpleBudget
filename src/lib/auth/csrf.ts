const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Hostname[:port] the browser used to reach us, allowing for a reverse proxy that forwards the original host. */
function expectedHosts(headers: Headers, urlHost: string): string[] {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = headers.get("host")?.trim();
  return [forwarded, host, urlHost].filter((h): h is string => !!h).map((h) => h.toLowerCase());
}

/**
 * CSRF defence for state-changing requests (on top of the SameSite session cookie): a browser always sends `Origin`
 * on cross-site POSTs, so a mismatch is refused. Requests without `Origin` or `Sec-Fetch-Site` come from scripts and
 * tools, not from a page in someone's browser, and still need the session cookie.
 */
export function isCrossSiteMutation(method: string, headers: Headers, urlHost: string): boolean {
  if (!UNSAFE.has(method.toUpperCase())) return false;
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return !expectedHosts(headers, urlHost).includes(new URL(origin).host.toLowerCase());
    } catch {
      return true;
    }
  }
  if (origin === "null") return true;
  const site = headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}
