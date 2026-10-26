"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, MoreHorizontal, Pencil, Play, Plus, Trash2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAiConfig } from "@/components/ai/ai-config";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAccountsOverview } from "@/hooks/use-lookups";
import type { AutomationRunView, AutomationView } from "@/lib/automations/types";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { automationToDraft, exampleDraft } from "./automation-draft";
import { AUTOMATIONS_KEY, AutomationEditor, type EditorTarget } from "./automation-editor";
import { DestinationsCard, useDestinations } from "./destinations-card";
import { describeAutomation } from "./describe";

const STATUS_LABEL = { sent: "Sent", skipped: "Skipped", error: "Failed" } as const;

function RunHistory({ automation, onClose }: { automation: AutomationView | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["automation-runs", automation?.id],
    queryFn: async () =>
      (await fetchJson<{ runs: AutomationRunView[] }>(`/api/automations/${automation!.id}/runs`)).runs,
    enabled: automation !== null,
  });
  return (
    <Sheet open={automation !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{automation?.name ?? "History"}</SheetTitle>
          <SheetDescription>The last 50 runs.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {query.isPending && <Skeleton className="h-24 w-full rounded-xl" aria-busy />}
          {query.isError && (
            <p role="alert" className="text-sm text-negative">
              Couldn&apos;t load the history.
            </p>
          )}
          {query.data?.length === 0 && <p className="text-sm text-muted-foreground">It hasn&apos;t run yet.</p>}
          <ul className="space-y-2" aria-label="Runs">
            {query.data?.map((r) => (
              <li
                key={r.id}
                className="space-y-1 rounded-xl border border-border p-3 text-sm"
                data-testid="automation-run"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={r.status === "error" ? "destructive" : "secondary"}>{STATUS_LABEL[r.status]}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(r.startedAt * 1000).toLocaleString()}</span>
                </div>
                {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
                {r.preview && <p className="break-words">{r.preview}</p>}
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AutomationsPanel() {
  const qc = useQueryClient();
  const { data: ai } = useAiConfig();
  const { data: destinations = [] } = useDestinations();
  const { data: groups = [] } = useAccountsOverview();
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [history, setHistory] = useState<AutomationView | null>(null);
  const [deleting, setDeleting] = useState<AutomationView | null>(null);

  const query = useQuery({
    queryKey: AUTOMATIONS_KEY,
    queryFn: async () => (await fetchJson<{ automations: AutomationView[] }>("/api/automations")).automations,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
    qc.invalidateQueries({ queryKey: ["automation-runs"] });
    qc.invalidateQueries({ queryKey: ["ai-usage"] });
  };
  const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof ApiError ? e.message : fallback);

  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) =>
      fetchJson(`/api/automations/${v.id}`, jsonBody("PATCH", { enabled: v.enabled })),
    onSuccess: refresh,
    onError: fail("Couldn't change that"),
  });
  const run = useMutation({
    mutationFn: (id: number) =>
      fetchJson<{ status: "sent" | "skipped" | "error"; reason?: string }>(`/api/automations/${id}/run`, {
        method: "POST",
      }),
    onSuccess: (r) => {
      if (r.status === "sent") toast.success("Sent");
      else if (r.status === "skipped") toast.message(`Skipped: ${r.reason ?? "nothing to do"}`);
      else toast.error(r.reason ?? "It failed");
      refresh();
    },
    onError: fail("Couldn't run that"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/automations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError: fail("Couldn't delete that"),
  });

  const destName = useMemo(() => new Map(destinations.map((d) => [d.id, d.name])), [destinations]);
  const accountLabel = useMemo(() => new Map(groups.flatMap((g) => g.accounts).map((a) => [a.id, a.label])), [groups]);
  const modelLabel = (id: string | null) => ai?.models.find((m) => m.id === id)?.label ?? id ?? undefined;
  const preferredDestination = destinations.find((d) => d.kind === "discord") ?? destinations[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Automations</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Send a message, a computed fact or an AI insight to Discord, ntfy or a webhook, on a schedule or when
          something happens. AI actions run without you pressing a button, so they count toward your monthly budget.
        </p>
      </div>

      <DestinationsCard />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Your automations</CardTitle>
            <CardDescription>Missed schedules aren&apos;t caught up if the server was off.</CardDescription>
          </div>
          <Button className="h-11 shrink-0 md:h-9" onClick={() => setEditing({ draft: exampleDraft(null) })}>
            <Plus /> New automation
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {query.isPending && <Skeleton className="h-20 w-full rounded-2xl" aria-busy />}
          {query.isError && (
            <div role="alert" className="flex items-center justify-between gap-3 text-sm">
              <span className="text-negative">Couldn&apos;t load automations.</span>
              <Button variant="outline" size="sm" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {query.data?.length === 0 && (
            <EmptyState
              icon={Workflow}
              title="No automations yet. Example: every Sunday, send a spending insight to Discord."
              action={
                <Button
                  className="h-11 md:h-9"
                  onClick={() => setEditing({ draft: exampleDraft(preferredDestination?.id ?? null) })}
                >
                  Use this example
                </Button>
              }
            />
          )}
          <ul className="space-y-2" aria-label="Automations">
            {query.data?.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-3"
                data-testid="automation"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium break-words">{a.name}</p>
                  <p className="text-xs break-words text-muted-foreground">
                    {describeAutomation(a, {
                      destination: destName.get(a.destinationId),
                      model: modelLabel(a.model),
                      account: a.trigger.type === "balance_below" ? accountLabel.get(a.trigger.accountId) : undefined,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.lastRunAt
                      ? `Last run ${new Date(a.lastRunAt * 1000).toLocaleString()}: ${a.lastStatus}`
                      : "Hasn't run yet"}
                  </p>
                </div>
                <Switch
                  checked={a.enabled}
                  onCheckedChange={(enabled) => toggle.mutate({ id: a.id, enabled })}
                  aria-label={`Enable ${a.name}`}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 md:size-9"
                      aria-label={`Actions for ${a.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing({ id: a.id, draft: automationToDraft(a) })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => run.mutate(a.id)} disabled={run.isPending}>
                      {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run now
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setHistory(a)}>
                      <History /> History
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(a)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          {query.data?.some((a) => a.trigger.type === "transaction") && (
            <p className="text-xs text-muted-foreground">
              Run now uses the newest matching transaction of the last 30 days as the example.
            </p>
          )}
        </CardContent>
      </Card>

      <AutomationEditor target={editing} onClose={() => setEditing(null)} />
      <RunHistory automation={history} onClose={() => setHistory(null)} />
      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this automation?"
        description={deleting ? `"${deleting.name}" and its history will be removed.` : undefined}
      >
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-11 md:h-9"
            onClick={() => deleting && remove.mutate(deleting.id)}
            disabled={remove.isPending}
          >
            Delete
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
