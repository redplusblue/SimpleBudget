"use client";

import { useQuery } from "@tanstack/react-query";
import type { SyncStatus } from "@/lib/simplefin/status";

export const SYNC_STATUS_KEY = ["sync-status"] as const;

export function useSyncStatus() {
  return useQuery({
    queryKey: SYNC_STATUS_KEY,
    queryFn: async (): Promise<SyncStatus> => {
      const res = await fetch("/api/sync/status");
      if (!res.ok) throw new Error("Failed to load sync status");
      return res.json();
    },
    // Poll quickly while a sync is running so progress feels live.
    refetchInterval: (q) => (q.state.data?.running ? 1500 : 60_000),
    staleTime: 0,
  });
}

export interface StartSyncResult {
  ok: boolean;
  message?: string;
}

/** Starts a sync; returns a user-presentable message on refusal. */
export async function requestSync(
  body: { mode?: "incremental" | "backfill"; days?: number } = {},
): Promise<StartSyncResult> {
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 202) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, message: data.message ?? "Couldn't start the sync." };
  } catch {
    return { ok: false, message: "Couldn't reach the server." };
  }
}
