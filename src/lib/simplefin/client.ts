import "server-only";
import { accountSetSchema, type SfAccountSet } from "./schemas";

export type SimpleFinErrorCode =
  "invalid_token" | "already_claimed" | "revoked" | "rate_limited" | "server" | "network" | "bad_response";

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

export interface FetchAccountsOptions {
  /** Decrypted access URL (contains credentials). Never log it. */
  accessUrl: string;
  /** Unix seconds. */
  start?: number;
  end?: number;
  pending?: boolean;
  balancesOnly?: boolean;
  accountIds?: string[];
  fetchImpl?: typeof fetch;
  /** Called once per HTTP attempt (retries included) so callers can count against the daily quota. */
  onRequest?: () => void;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
}

const FETCH_TIMEOUT_MS = 30_000;
const RETRIES = 2;
const BACKOFF_MS = 500;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `fetch` rejects URLs with embedded credentials, so they move into a Basic auth header. */
export function buildAccountsRequest(
  opts: Pick<FetchAccountsOptions, "accessUrl" | "start" | "end" | "pending" | "balancesOnly" | "accountIds">,
) {
  let base: URL;
  try {
    base = new URL(opts.accessUrl);
  } catch {
    throw new SimpleFinError("bad_response", "The stored SimpleFIN access URL is invalid. Reconnect SimpleFIN.");
  }
  const user = decodeURIComponent(base.username);
  const pass = decodeURIComponent(base.password);
  const url = new URL(`${base.origin}${base.pathname.replace(/\/+$/, "")}/accounts`);
  if (opts.start !== undefined) url.searchParams.set("start-date", String(Math.floor(opts.start)));
  if (opts.end !== undefined) url.searchParams.set("end-date", String(Math.floor(opts.end)));
  if (opts.pending) url.searchParams.set("pending", "1");
  if (opts.balancesOnly) url.searchParams.set("balances-only", "1");
  for (const id of opts.accountIds ?? []) url.searchParams.append("account", id);
  const authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  return { url: url.toString(), authorization };
}

/** GET {accessUrl}/accounts with a timeout, retries on 5xx/network errors only, and typed errors. */
export async function fetchAccounts(opts: FetchAccountsOptions): Promise<SfAccountSet> {
  const { url, authorization } = buildAccountsRequest(opts);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retries ?? RETRIES;

  let lastError: SimpleFinError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    opts.onRequest?.();

    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Authorization: authorization, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
      });
    } catch {
      lastError = new SimpleFinError("network", "Couldn't reach SimpleFIN.");
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new SimpleFinError("revoked", "SimpleFIN access revoked — reconnect.");
    }
    if (res.status === 429) {
      throw new SimpleFinError("rate_limited", "SimpleFIN is rate limiting requests. Try again later.");
    }
    if (res.status >= 500) {
      lastError = new SimpleFinError("server", `SimpleFIN returned an error (HTTP ${res.status}).`);
      continue;
    }
    if (!res.ok) {
      throw new SimpleFinError("bad_response", `SimpleFIN rejected the request (HTTP ${res.status}).`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SimpleFinError("bad_response", "SimpleFIN returned something that isn't JSON.");
    }
    const parsed = accountSetSchema.safeParse(json);
    if (!parsed.success) {
      throw new SimpleFinError("bad_response", "SimpleFIN returned data in an unexpected format.");
    }
    return parsed.data;
  }
  throw lastError ?? new SimpleFinError("network", "Couldn't reach SimpleFIN.");
}
