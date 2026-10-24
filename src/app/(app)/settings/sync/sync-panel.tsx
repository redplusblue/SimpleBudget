"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestSync, SYNC_STATUS_KEY, useSyncStatus } from "@/hooks/use-sync-status";
import type { SyncRunSummary } from "@/lib/simplefin/status";

const SCHEDULES = [
  ["off", "Off (manual only)"],
  ["3h", "Every 3 hours"],
  ["6h", "Every 6 hours"],
  ["12h", "Every 12 hours"],
  ["24h", "Daily"],
] as const;

const STATUS_BADGE: Record<SyncRunSummary["status"], { label: string; className: string }> = {
  ok: { label: "OK", className: "bg-positive/15 text-positive" },
  partial: { label: "Partial", className: "bg-warning/15 text-warning" },
  error: { label: "Failed", className: "bg-negative/15 text-negative" },
};

export function SyncPanel() {
  const qc = useQueryClient();
  const status = useSyncStatus();
  const [starting, setStarting] = useState(false);

  const runs = useQuery({
    queryKey: ["sync-runs"],
    queryFn: async (): Promise<SyncRunSummary[]> => {
      const res = await fetch("/api/sync/runs?limit=20");
      if (!res.ok) throw new Error("Failed to load history");
      return (await res.json()).runs;
    },
    // Refetch whenever the running flag flips so a finished run shows up without a reload.
    refetchInterval: status.data?.running ? 3000 : false,
  });

  const schedule = useMutation({
    mutationFn: async (value: string) => {
      const res = await fetch("/api/sync/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: value }),
      });
      if (!res.ok) throw new Error();
    },
    onSuccess: () => {
      toast.success("Schedule updated");
      qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
    },
    onError: () => toast.error("Couldn't update the schedule"),
  });

  async function syncNow() {
    setStarting(true);
    const res = await requestSync({ mode: "incremental" });
    setStarting(false);
    if (!res.ok) toast.error(res.message ?? "Couldn't start the sync.");
    qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
  }

  const s = status.data;
  const busy = starting || !!s?.running;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Automatic sync</CardTitle>
          <CardDescription>
            SimpleFIN Bridge allows about 24 requests a day, so SimpleBudget stops at {s?.requestLimit ?? 20}. Each sync
            re-fetches the last 14 days to catch pending transactions that post late.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!s ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label htmlFor="schedule" className="text-sm font-medium">
                  Schedule
                </label>
                <Select value={s.schedule} onValueChange={(v) => schedule.mutate(v)}>
                  <SelectTrigger id="schedule" className="h-11 w-full sm:h-9 sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULES.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {s.requestsToday}/{s.requestLimit} requests used today
                </span>
                <Button
                  onClick={syncNow}
                  disabled={busy || s.manualWaitSeconds > 0 || !s.hasConnections}
                  className="h-11 md:h-9"
                >
                  {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {s.manualWaitSeconds > 0 && !busy ? `Sync in ${Math.ceil(s.manualWaitSeconds / 60)} min` : "Sync now"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : runs.isError ? (
            <p role="alert" className="text-sm text-negative">
              Couldn&apos;t load sync history.
            </p>
          ) : runs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No syncs yet.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Added</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Updated</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Requests</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.data.map((r) => {
                    const badge = STATUS_BADGE[r.status];
                    return (
                      <TableRow key={r.id} className="align-top">
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(r.startedAt * 1000), "MMM d, h:mm a")}
                        </TableCell>
                        <TableCell>
                          <Badge className={badge.className}>
                            {r.finishedAt === null ? "Unfinished" : badge.label}
                          </Badge>
                          {r.errors.map((e) => (
                            <p
                              key={e}
                              className="mt-1 max-w-64 text-xs break-words whitespace-normal text-muted-foreground"
                            >
                              {e}
                            </p>
                          ))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.txnsAdded}</TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.txnsUpdated}</TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.requestsUsed}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
