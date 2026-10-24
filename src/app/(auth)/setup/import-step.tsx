"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { requestSync, useSyncStatus } from "@/hooks/use-sync-status";

const RANGES = [30, 90, 180, 365] as const;
const WINDOW_DAYS = 60;

export function ImportStep() {
  const router = useRouter();
  const { data: status, refetch } = useSyncStatus();
  const [days, setDays] = useState<number>(90);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const running = !!status?.running || starting;
  const lastRun = status?.lastRun ?? null;
  // The previous attempt's problems stay visible so a reload doesn't hide why it failed.
  const failedErrors =
    !running && lastRun && lastRun.accountsUpdated === 0
      ? lastRun.errors.length
        ? lastRun.errors
        : ["SimpleFIN didn't return any accounts."]
      : [];

  // When a sync finishes, ask the server which step comes next: accounts exist -> confirm them,
  // otherwise stay and show errors. Fast syncs can finish between polls, so besides watching the
  // running flag flip we also compare against the last run we saw when Start was pressed.
  const wasRunning = useRef(false);
  const baseline = useRef<number | null>(null);
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!status) return;
    const lastId = status.lastRun?.id ?? 0;
    const flippedOff = wasRunning.current && !status.running;
    const ours =
      baseline.current !== null && !status.running && lastId > baseline.current && handled.current !== lastId;
    wasRunning.current = status.running;
    if (flippedOff || ours) {
      handled.current = lastId;
      router.refresh();
    }
  }, [status, router]);

  async function start() {
    setError(null);
    setStarting(true);
    baseline.current = status?.lastRun?.id ?? 0;
    const res = await requestSync({ mode: "backfill", days });
    setStarting(false);
    if (!res.ok) {
      setError(res.message ?? "Couldn't start the import.");
      return;
    }
    refetch();
  }

  const requests = Math.ceil(days / WINDOW_DAYS);
  const pct =
    status?.progress && status.progress.total > 0
      ? Math.round((status.progress.done / status.progress.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Import your history</CardTitle>
        <CardDescription>How far back should we pull transactions?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ToggleGroup
          type="single"
          value={String(days)}
          onValueChange={(v) => v && setDays(Number(v))}
          disabled={running}
          variant="outline"
          className="w-full"
          aria-label="History range"
        >
          {RANGES.map((d) => (
            <ToggleGroupItem key={d} value={String(d)} className="h-11 flex-1 md:h-9">
              {d} days
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          This uses {requests} of your {status?.requestLimit ?? 20} daily SimpleFIN requests per connection. Longer
          ranges use more, and you can always sync again tomorrow.
        </p>

        {running && (
          <div role="status" aria-live="polite" className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="bg-brand-gradient h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.max(pct, 6)}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Importing{status?.progress ? ` (${status.progress.done} of ${status.progress.total})` : ""}… this can take
              a minute.
            </p>
          </div>
        )}

        {(error || failedErrors.length > 0) && (
          <div role="alert" className="space-y-1 rounded-xl border border-border bg-surface-2 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-negative">
              <AlertCircle className="size-4" /> {error ? "Couldn't import" : "The import didn't bring in any accounts"}
            </p>
            {(error ? [error] : failedErrors).map((e) => (
              <p key={e} className="text-muted-foreground">
                {e}
              </p>
            ))}
          </div>
        )}

        <Button onClick={start} disabled={running} className="bg-brand-gradient h-11 w-full text-white md:h-9">
          {running && <Loader2 className="animate-spin" />}
          {running ? "Importing…" : failedErrors.length || error ? "Try again" : "Start import"}
        </Button>
      </CardContent>
    </Card>
  );
}
