"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchJson } from "@/lib/fetch-json";

interface About {
  version: string;
  nodeVersion: string;
  timeZone: string;
  dbSizeBytes: number;
  backups: Array<{ name: string; sizeBytes: number; createdAt: number }>;
  backupCount: number;
  lastBackupAt: number | null;
}

const KEY = ["about"] as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AboutPanel() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => fetchJson<About>("/api/about") });
  const backup = useMutation({
    mutationFn: () => fetchJson("/api/about/backup", { method: "POST" }),
    onSuccess: () => {
      toast.success("Backup written");
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "The backup failed"),
  });

  if (query.isPending) return <Skeleton className="h-64 w-full rounded-2xl" aria-busy />;
  if (query.isError)
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <span className="text-negative">Couldn&apos;t load this page.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  const a = query.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>About SimpleBudget</CardTitle>
          <CardDescription>A self-hosted personal finance dashboard. Your data stays on this server.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border/60 rounded-xl border border-border px-3 text-sm">
            <Row label="Version">{a.version}</Row>
            <Row label="Database size">{formatBytes(a.dbSizeBytes)}</Row>
            <Row label="Time zone">{a.timeZone}</Row>
            <Row label="Runtime">Node {a.nodeVersion}</Row>
            <Row label="Last backup">
              {a.lastBackupAt ? format(new Date(a.lastBackupAt * 1000), "MMM d, yyyy h:mm a") : "None yet"}
            </Row>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Backups</CardTitle>
          <CardDescription>
            A backup is written every night and the newest 14 are kept in the data folder. You can also take one now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {a.backups.length > 0 && (
            <ul
              className="divide-y divide-border/60 rounded-xl border border-border px-3 text-sm"
              data-testid="backup-list"
            >
              {a.backups.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">{b.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}
          {a.backupCount > a.backups.length && (
            <p className="text-xs text-muted-foreground">And {a.backupCount - a.backups.length} older.</p>
          )}
          <Button variant="outline" className="h-11 md:h-9" disabled={backup.isPending} onClick={() => backup.mutate()}>
            {backup.isPending && <Loader2 className="animate-spin" />} Back up now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}
