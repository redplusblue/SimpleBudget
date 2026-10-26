import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { notifyDestinations, NOTIFY_DESTINATION_KINDS } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { notifyUrlProblem } from "@/lib/notify/url";
import { sendNotification, type Notification } from "@/lib/notify/send";

export class DestinationError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

export interface DestinationView {
  id: number;
  name: string;
  kind: (typeof NOTIFY_DESTINATION_KINDS)[number];
  /** Just the host, so you can tell where it goes. The address itself never leaves the server. */
  host: string | null;
}

const hostOf = (urlEnc: string): string | null => {
  try {
    return new URL(decrypt(urlEnc)).host;
  } catch {
    return null;
  }
};

const toView = (r: typeof notifyDestinations.$inferSelect): DestinationView => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  host: hostOf(r.urlEnc),
});

export function listDestinations(db: DbLike): DestinationView[] {
  return db.select().from(notifyDestinations).orderBy(notifyDestinations.id).all().map(toView);
}

const name = z.string().trim().min(1, "Give it a name").max(60);
const token = z.string().trim().min(1).max(500);

export const destinationInputSchema = z
  .object({
    name,
    kind: z.enum(NOTIFY_DESTINATION_KINDS),
    url: z.string().trim().min(1, "Paste the address").max(500),
    token: token.nullish(),
  })
  .strict();

export const destinationPatchSchema = z
  .object({
    name,
    kind: z.enum(NOTIFY_DESTINATION_KINDS),
    url: z.string().trim().min(1).max(500),
    /** A string replaces the saved token; null removes it. */
    token: token.nullable(),
  })
  .partial()
  .strict();

function check(kind: string, url: string) {
  const problem = notifyUrlProblem(kind, url);
  if (problem) throw new DestinationError("invalid", problem);
}

export function createDestination(db: DbLike, input: unknown, now = Math.floor(Date.now() / 1000)): DestinationView {
  const v = destinationInputSchema.parse(input);
  check(v.kind, v.url);
  const row = db
    .insert(notifyDestinations)
    .values({
      name: v.name,
      kind: v.kind,
      urlEnc: encrypt(v.url),
      tokenEnc: v.token && v.kind !== "discord" ? encrypt(v.token) : null,
      createdAt: now,
    })
    .returning()
    .get();
  return toView(row);
}

export function updateDestination(db: DbLike, id: number, input: unknown): DestinationView {
  const patch = destinationPatchSchema.parse(input);
  const row = db.select().from(notifyDestinations).where(eq(notifyDestinations.id, id)).get();
  if (!row) throw new DestinationError("not_found", "Destination not found");
  const kind = patch.kind ?? row.kind;
  // A new address, or a changed kind, must suit the kind (the saved address is checked too).
  if (patch.url !== undefined || patch.kind !== undefined) {
    let url = patch.url;
    if (url === undefined) {
      try {
        url = decrypt(row.urlEnc);
      } catch {
        throw new DestinationError("invalid", "The saved address couldn't be read. Enter it again.");
      }
    }
    check(kind, url);
  }
  const set: Partial<typeof notifyDestinations.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.url !== undefined) set.urlEnc = encrypt(patch.url);
  if (patch.token === null || patch.kind === "discord") set.tokenEnc = null;
  else if (patch.token !== undefined) set.tokenEnc = encrypt(patch.token);
  if (Object.keys(set).length === 0) throw new DestinationError("invalid", "Nothing to change");
  return toView(db.update(notifyDestinations).set(set).where(eq(notifyDestinations.id, id)).returning().get());
}

export function deleteDestination(db: DbLike, id: number): void {
  if (!db.select({ id: notifyDestinations.id }).from(notifyDestinations).where(eq(notifyDestinations.id, id)).get())
    throw new DestinationError("not_found", "Destination not found");
  db.delete(notifyDestinations).where(eq(notifyDestinations.id, id)).run();
}

/** Sends one notification. Never throws: false when the destination is missing, unreadable or doesn't answer. */
export async function sendTo(
  db: DbLike,
  id: number,
  n: Notification,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; status: number | null }> {
  const row = db.select().from(notifyDestinations).where(eq(notifyDestinations.id, id)).get();
  if (!row) return { ok: false, status: null };
  try {
    return await sendNotification(
      { kind: row.kind, url: decrypt(row.urlEnc), token: row.tokenEnc ? decrypt(row.tokenEnc) : null },
      n,
      fetchImpl,
    );
  } catch {
    return { ok: false, status: null };
  }
}
