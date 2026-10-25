import "server-only";

export interface Notification {
  title: string;
  message: string;
  /** "default" | "high": high makes ntfy alert louder. */
  priority?: "default" | "high";
  /** The kind of event, for webhook receivers: sync_failed, large_transaction, test. */
  event: "sync_failed" | "large_transaction" | "test";
}

export interface SendTarget {
  kind: "ntfy" | "webhook";
  url: string;
  token: string | null;
}

const TIMEOUT_MS = 8_000;

/** HTTP headers must be plain ASCII/latin-1; ntfy reads Title from one. */
const headerSafe = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);

/**
 * Sends one notification: ntfy gets the message as the body with Title/Priority headers, any other server gets a
 * small JSON document. Never throws; the caller learns whether it worked (and the HTTP status), never the address.
 */
export async function sendNotification(
  target: SendTarget,
  n: Notification,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number | null }> {
  const headers: Record<string, string> = {};
  if (target.token) headers.authorization = `Bearer ${target.token}`;
  let body: string;
  if (target.kind === "ntfy") {
    headers.title = headerSafe(n.title);
    headers.priority = n.priority === "high" ? "high" : "default";
    headers.tags =
      n.event === "sync_failed" ? "warning" : n.event === "large_transaction" ? "moneybag" : "white_check_mark";
    headers["content-type"] = "text/plain; charset=utf-8";
    body = n.message;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify({
      app: "SimpleBudget",
      event: n.event,
      title: n.title,
      message: n.message,
      priority: n.priority ?? "default",
    });
  }
  try {
    const res = await fetchImpl(target.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}
