import "server-only";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { decrypt, encrypt } from "@/lib/crypto";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { notifyUrlProblem } from "./url";

const K = {
  enabled: "notify:enabled",
  kind: "notify:kind",
  url: "notify:url",
  token: "notify:token",
  largeCents: "notify:large_cents",
  onLarge: "notify:on_large",
  onFailure: "notify:on_failure",
  details: "notify:details",
} as const;

export const NOTIFY_KINDS = ["ntfy", "webhook", "discord"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export const DEFAULT_LARGE_CENTS = 500_00;

/** What the settings page may see. The URL (which can contain a secret topic or token) and the token never leave the server. */
export interface NotifyConfig {
  enabled: boolean;
  kind: NotifyKind;
  /** Whether a destination is saved (the address itself is write-only). */
  hasUrl: boolean;
  /** Just the host, so you can tell where notifications go. */
  host: string | null;
  hasToken: boolean;
  largeCents: number;
  onLarge: boolean;
  onFailure: boolean;
  /** Include the payee and account in large-transaction messages. */
  details: boolean;
}

export class NotifyConfigError extends Error {
  readonly code = "invalid" as const;
}

const flag = (db: DbLike, key: string, fallback: boolean) => {
  const v = getSetting(db, key);
  return v === undefined ? fallback : v === "1";
};

export function getNotifyConfig(db: DbLike): NotifyConfig {
  const url = getSetting(db, K.url);
  const kind = getSetting(db, K.kind);
  let host: string | null = null;
  if (url)
    try {
      host = new URL(decrypt(url)).host;
    } catch {
      host = null;
    }
  return {
    enabled: flag(db, K.enabled, false),
    kind: NOTIFY_KINDS.includes(kind as NotifyKind) ? (kind as NotifyKind) : "ntfy",
    hasUrl: url !== undefined,
    host,
    hasToken: getSetting(db, K.token) !== undefined,
    largeCents: Number(getSetting(db, K.largeCents)) || DEFAULT_LARGE_CENTS,
    onLarge: flag(db, K.onLarge, true),
    onFailure: flag(db, K.onFailure, true),
    details: flag(db, K.details, false),
  };
}

/** The destination and token for sending; throws if the stored values can't be read (e.g. APP_SECRET changed). */
export function getNotifyTarget(db: DbLike): { kind: NotifyKind; url: string; token: string | null } | null {
  const url = getSetting(db, K.url);
  if (!url) return null;
  const token = getSetting(db, K.token);
  return { kind: getNotifyConfig(db).kind, url: decrypt(url), token: token ? decrypt(token) : null };
}

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), "Use a full address starting with http:// or https://");

export const notifyPatchSchema = z
  .object({
    enabled: z.boolean(),
    kind: z.enum(NOTIFY_KINDS),
    /** A string replaces the saved address; null removes it. */
    url: httpUrl.nullable(),
    token: z.string().trim().min(1).max(500).nullable(),
    largeCents: z.number().int().min(1_00, "Choose at least $1").max(100_000_000_00),
    onLarge: z.boolean(),
    onFailure: z.boolean(),
    details: z.boolean(),
  })
  .partial()
  .strict();

export function updateNotifyConfig(db: DbLike, input: unknown): NotifyConfig {
  const patch = notifyPatchSchema.parse(input);
  const current = getNotifyConfig(db);
  const hasUrl = patch.url === undefined ? current.hasUrl : patch.url !== null;
  if ((patch.enabled ?? current.enabled) && !hasUrl)
    throw new NotifyConfigError("Add where notifications should go before turning them on.");
  // A new address, or a changed kind with an address already saved, must suit the kind.
  const kind = patch.kind ?? current.kind;
  const urlToCheck =
    typeof patch.url === "string"
      ? patch.url
      : patch.url === undefined && current.hasUrl
        ? getNotifyTarget(db)?.url
        : undefined;
  const problem = urlToCheck ? notifyUrlProblem(kind, urlToCheck) : null;
  if (problem) throw new NotifyConfigError(problem);
  db.transaction((tx) => {
    const bool = (key: string, v: boolean | undefined) => v !== undefined && setSetting(tx, key, v ? "1" : "0");
    bool(K.enabled, patch.enabled);
    bool(K.onLarge, patch.onLarge);
    bool(K.onFailure, patch.onFailure);
    bool(K.details, patch.details);
    if (patch.kind !== undefined) setSetting(tx, K.kind, patch.kind);
    if (patch.largeCents !== undefined) setSetting(tx, K.largeCents, String(patch.largeCents));
    if (patch.url === null) deleteSetting(tx, K.url);
    else if (patch.url !== undefined) setSetting(tx, K.url, encrypt(patch.url));
    if (patch.token === null) deleteSetting(tx, K.token);
    else if (patch.token !== undefined) setSetting(tx, K.token, encrypt(patch.token));
  });
  return getNotifyConfig(db);
}
