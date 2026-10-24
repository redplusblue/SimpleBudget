"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Landmark, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConnectSimpleFinForm } from "@/components/connect-simplefin-form";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface Connection {
  id: number;
  orgName: string;
  orgDomain: string | null;
  createdAt: number;
  lastError: string | null;
  accountCount: number;
}

const KEY = ["connections"] as const;

export function ConnectionsPanel() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const [deleteData, setDeleteData] = useState(false);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Connection[]> => {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error("Failed to load connections");
      return (await res.json()).connections;
    },
  });

  const remove = useMutation({
    mutationFn: async ({ id, deleteData }: { id: number; deleteData: boolean }) => {
      const res = await fetch(`/api/connections/${id}?deleteData=${deleteData}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove connection");
    },
    onSuccess: () => {
      toast.success("Connection removed");
      setRemoving(null);
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => toast.error("Couldn't remove the connection"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>SimpleFIN connections</CardTitle>
        <CardDescription>Each setup token you add becomes a connection that can include several banks.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : query.isError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-xl border border-border p-4 text-sm"
          >
            <span className="text-negative">Couldn&apos;t load connections.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : query.data.length === 0 ? (
          <EmptyState icon={Landmark} title="No connections yet. Add a SimpleFIN setup token to get started." />
        ) : (
          <ul className="space-y-2">
            {query.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
                  <Landmark className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.orgName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.accountCount} account{c.accountCount === 1 ? "" : "s"} · added{" "}
                    {format(new Date(c.createdAt * 1000), "MMM d, yyyy")}
                  </p>
                  {c.lastError && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span className="break-words">{c.lastError}</span>
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${c.orgName} connection`}
                  className="size-11 shrink-0 md:size-9"
                  onClick={() => {
                    setDeleteData(false);
                    setRemoving(c);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={() => setAdding(true)} className="h-11 w-full md:h-9">
          <Plus /> Add another setup token
        </Button>
      </CardContent>

      <ResponsiveDialog open={adding} onOpenChange={setAdding} title="Add a setup token">
        <ConnectSimpleFinForm
          onConnected={() => {
            setAdding(false);
            toast.success("SimpleFIN connected");
            qc.invalidateQueries({ queryKey: KEY });
          }}
        />
      </ResponsiveDialog>

      <ResponsiveDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove connection?"
        description="SimpleBudget will stop syncing this connection and forget its access credentials."
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3">
            <Label htmlFor="delete-data" className="flex-col items-start gap-1 text-sm leading-snug font-medium">
              Also delete its imported data
              <span className="text-xs font-normal text-muted-foreground">
                Removes its accounts, transactions and balance history. Otherwise they&apos;re kept.
              </span>
            </Label>
            <Switch id="delete-data" checked={deleteData} onCheckedChange={setDeleteData} />
          </div>
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="outline" className="h-11 md:h-9" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-11 md:h-9"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate({ id: removing.id, deleteData })}
            >
              {remove.isPending && <Loader2 className="animate-spin" />} Remove
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </Card>
  );
}
