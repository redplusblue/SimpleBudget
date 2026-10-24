import "server-only";
import { count, eq } from "drizzle-orm";
import type { Db } from "@/db/open";
import { accounts, connections } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import { deleteSetting, getSetting, setSetting, SETTING_KEYS } from "./settings";

export interface ConnectionSummary {
  id: number;
  orgName: string;
  orgDomain: string | null;
  createdAt: number;
  lastError: string | null;
  accountCount: number;
}

const accessUrlKey = (id: number) => `${SETTING_KEYS.accessUrlPrefix}${id}`;

/** Stores a freshly claimed access URL (encrypted) and returns the new connection id. */
export function addConnection(db: Db, accessUrl: string): number {
  return db.transaction((tx) => {
    const row = tx.insert(connections).values({ orgName: "SimpleFIN" }).returning({ id: connections.id }).get();
    setSetting(tx as unknown as Db, accessUrlKey(row.id), encrypt(accessUrl));
    return row.id;
  });
}

/** Decrypted access URL; server-side use only, never send to the client or log it. */
export function getAccessUrl(db: Db, connectionId: number): string | undefined {
  const blob = getSetting(db, accessUrlKey(connectionId));
  return blob ? decrypt(blob) : undefined;
}

export function listConnections(db: Db): ConnectionSummary[] {
  return db
    .select({
      id: connections.id,
      orgName: connections.orgName,
      orgDomain: connections.orgDomain,
      createdAt: connections.createdAt,
      lastError: connections.lastError,
      accountCount: count(accounts.id),
    })
    .from(connections)
    .leftJoin(accounts, eq(accounts.connectionId, connections.id))
    .groupBy(connections.id)
    .orderBy(connections.id)
    .all();
}

/**
 * Removes a connection and its stored credentials. With `deleteData` the connection's
 * accounts (and their transactions and snapshots) go too; otherwise they're kept, detached.
 */
export function removeConnection(db: Db, id: number, opts: { deleteData: boolean }): boolean {
  return db.transaction((tx) => {
    if (!tx.select({ id: connections.id }).from(connections).where(eq(connections.id, id)).get()) return false;
    if (opts.deleteData) {
      tx.delete(accounts).where(eq(accounts.connectionId, id)).run();
    } else {
      tx.update(accounts).set({ connectionId: null }).where(eq(accounts.connectionId, id)).run();
    }
    tx.delete(connections).where(eq(connections.id, id)).run();
    deleteSetting(tx as unknown as Db, accessUrlKey(id));
    return true;
  });
}
