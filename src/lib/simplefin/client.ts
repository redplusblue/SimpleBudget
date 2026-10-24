import "server-only";

export type SimpleFinErrorCode =
  "invalid_token" | "already_claimed" | "revoked" | "server" | "network" | "bad_response";

/** Messages never include URLs: access URLs embed credentials. */
export class SimpleFinError extends Error {
  constructor(
    readonly code: SimpleFinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SimpleFinError";
  }
}

const CLAIM_TIMEOUT_MS = 30_000;

/** A setup token is base64 (standard or URL-safe) of the claim URL. */
export function decodeSetupToken(token: string): string {
  const cleaned = token.replace(/\s+/g, "");
  if (!cleaned || !/^[A-Za-z0-9+/_-]+=*$/.test(cleaned)) {
    throw new SimpleFinError("invalid_token", "That doesn't look like a SimpleFIN setup token.");
  }
  const decoded = Buffer.from(cleaned.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    throw new SimpleFinError("invalid_token", "That doesn't look like a SimpleFIN setup token.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new SimpleFinError("invalid_token", "That doesn't look like a SimpleFIN setup token.");
  }
  return url.toString();
}

/** Exchanges a setup token for an access URL. A token can be claimed only once. */
export async function claimSetupToken(
  token: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const claimUrl = decodeSetupToken(token);
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(claimUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Length": "0" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? CLAIM_TIMEOUT_MS),
    });
  } catch {
    throw new SimpleFinError("network", "Couldn't reach SimpleFIN. Check your connection and try again.");
  }

  if (res.status === 403) {
    throw new SimpleFinError(
      "already_claimed",
      "SimpleFIN rejected this token: it was already used or is invalid. Create a new setup token and try again.",
    );
  }
  if (res.status === 400 || res.status === 404) {
    throw new SimpleFinError("invalid_token", "SimpleFIN didn't recognize this setup token.");
  }
  if (!res.ok) {
    throw new SimpleFinError("server", `SimpleFIN returned an error (HTTP ${res.status}). Try again later.`);
  }

  const accessUrl = (await res.text()).trim();
  let parsed: URL;
  try {
    parsed = new URL(accessUrl);
  } catch {
    throw new SimpleFinError("bad_response", "SimpleFIN returned an unexpected response.");
  }
  if (parsed.protocol !== "https:" || !parsed.username || !parsed.password) {
    throw new SimpleFinError("bad_response", "SimpleFIN returned an unexpected response.");
  }
  return accessUrl;
}
