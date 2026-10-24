"use client";

import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { requestSync, SYNC_STATUS_KEY, useSyncStatus } from "@/hooks/use-sync-status";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

export function SyncPill() {
  const { data } = useSyncStatus();
  const qc = useQueryClient();
  const router = useRouter();
  const now = useNow();
  const [starting, setStarting] = useState(false);

  // When a running sync finishes, refresh every data view and tell the user how it went.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (wasRunning.current && !data.running && data.lastRun) {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SYNC_STATUS_KEY[0] });
      router.refresh();
      const r = data.lastRun;
      if (r.status === "ok")
        toast.success(`Sync complete · ${r.txnsAdded} new transaction${r.txnsAdded === 1 ? "" : "s"}`);
      else if (r.status === "partial") toast.warning("Sync finished with problems", { description: r.errors[0] });
      else toast.error("Sync failed", { description: r.errors[0] });
    }
    wasRunning.current = data.running;
  }, [data, qc, router]);

  if (!data || !data.hasConnections) return null;

  const problems = [
    ...(data.lastRun && data.lastRun.status !== "ok" ? data.lastRun.errors : []),
    ...data.connectionErrors,
  ];
  const unique = [...new Set(problems)];
  const hasProblem = unique.length > 0 || data.lastRun?.status === "error";
  const busy = data.running || starting;

  const label = data.running
    ? data.progress && data.progress.total > 1
      ? `Syncing ${Math.min(data.progress.done + 1, data.progress.total)}/${data.progress.total}…`
      : "Syncing…"
    : data.lastSuccessAt
      ? `Synced ${formatDistanceToNowStrict(data.lastSuccessAt * 1000, { addSuffix: true })}`
      : "Not synced yet";
  void now; // dependency so the label refreshes on the interval

  async function syncNow() {
    setStarting(true);
    const res = await requestSync({ mode: "incremental" });
    setStarting(false);
    if (!res.ok) toast.error(res.message ?? "Couldn't start the sync.");
    qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
  }

  const wait = data.manualWaitSeconds;

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-label={`${label}. Sync details`}
            className="relative h-11 gap-2 rounded-full px-3 text-xs md:h-9"
          >
            {hasProblem && !data.running && (
              <span
                className="absolute top-1.5 right-2 size-2 rounded-full bg-negative ring-2 ring-background"
                aria-hidden
              />
            )}
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : hasProblem ? (
              <AlertCircle className="size-3.5 text-negative" />
            ) : (
              <CheckCircle2 className="size-3.5 text-positive" />
            )}
            <span className="hidden sm:inline">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              {data.requestsToday}/{data.requestLimit} SimpleFIN requests used today
            </p>
          </div>
          {unique.length > 0 ? (
            <ul className="space-y-1.5" aria-label="Sync problems">
              {unique.map((e) => (
                <li key={e} className="flex gap-2 text-xs text-warning">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                  <span className="break-words">{e}</span>
                </li>
              ))}
            </ul>
          ) : (
            data.lastRun && (
              <p className="text-xs text-muted-foreground">
                Last run: {data.lastRun.txnsAdded} added, {data.lastRun.txnsUpdated} updated.
              </p>
            )
          )}
          <Link href="/settings/sync" className="block text-xs text-primary underline-offset-4 hover:underline">
            Sync history & schedule
          </Link>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        onClick={syncNow}
        disabled={busy || wait > 0}
        aria-label={wait > 0 ? `Sync now (available in ${Math.ceil(wait / 60)} min)` : "Sync now"}
        title={wait > 0 ? `Available in ${Math.ceil(wait / 60)} min` : "Sync now"}
        className="size-11 md:size-9"
      >
        <RefreshCw className={cn("size-4", busy && "animate-spin")} />
      </Button>
    </div>
  );
}
