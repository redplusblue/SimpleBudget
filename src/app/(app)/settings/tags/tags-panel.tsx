"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, Pencil, Plus, Tag, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_PALETTE } from "@/db/palette";
import { TargetDialog, type TargetDialogState } from "@/components/targets/target-dialog";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import type { TagAdminRow } from "@/lib/finance/taxonomy-schemas";
import type { TargetRow } from "@/lib/finance/targets-types";
import { cn } from "@/lib/utils";

const KEY = ["tags-admin"] as const;
const plural = (n: number) => `${n.toLocaleString()} transaction${n === 1 ? "" : "s"}`;

export function TagsPanel() {
  const invalidate = useInvalidateTaxonomy();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<TagAdminRow | null>(null);
  const [deleting, setDeleting] = useState<TagAdminRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetDialog, setTargetDialog] = useState<TargetDialogState | null>(null);
  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: async () => (await fetchJson<{ targets: TargetRow[] }>("/api/targets")).targets,
  });
  const openTarget = (t: TagAdminRow) => {
    const existing = targets.data?.find((x) => x.kind === "tag" && x.subjectId === t.id && x.month === null);
    setTargetDialog(existing ? { target: existing } : { preset: { kind: "tag", subjectId: t.id } });
  };

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ tags: TagAdminRow[] }>("/api/tags/admin")).tags,
  });
  const close = () => {
    setEditing(null);
    setDeleting(null);
    setError(null);
  };
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong");

  const create = useMutation({
    mutationFn: (name: string) => fetchJson("/api/tags", jsonBody("POST", { name })),
    onSuccess: () => {
      invalidate();
      setNewName("");
    },
    onError: () => toast.error("Couldn't create that tag"),
  });
  const save = useMutation({
    mutationFn: (v: { id: number; name: string; color: string }) =>
      fetchJson(`/api/tags/${v.id}`, jsonBody("PATCH", { name: v.name, color: v.color })),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (t: TagAdminRow) => fetchJson(`/api/tags/${t.id}`, { method: "DELETE" }),
    onSuccess: (_d, t) => {
      invalidate();
      toast.success(`Deleted ${t.name}`);
      close();
    },
    onError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
        <CardDescription>
          Free-form labels that can overlap, like &ldquo;vacation&rdquo; or &ldquo;reimbursable&rdquo;. You can also
          create tags while editing a transaction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName);
          }}
        >
          <Input
            aria-label="New tag name"
            placeholder="New tag"
            value={newName}
            maxLength={40}
            onChange={(e) => setNewName(e.target.value)}
            className="h-11 md:h-9"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!newName.trim() || create.isPending}
            className="h-11 md:h-9"
          >
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add
          </Button>
        </form>

        {query.isPending ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load tags.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : query.data.length === 0 ? (
          <EmptyState icon={Tag} title="No tags yet. Add one above." />
        ) : (
          <ul className="space-y-2">
            {query.data.map((t) => (
              <li
                key={t.id}
                data-testid="tag-row"
                className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 p-2.5 pl-3.5"
              >
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: t.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{plural(t.txnCount)}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 md:size-9"
                      aria-label={`Actions for ${t.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(t)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openTarget(t)}>
                      <Target /> Set monthly target…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(t)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <TargetDialog state={targetDialog} onClose={() => setTargetDialog(null)} />

      <ResponsiveDialog open={editing !== null} onOpenChange={(o) => !o && close()} title="Edit tag">
        {editing && (
          <TagForm
            key={editing.id}
            tag={editing}
            busy={save.isPending}
            error={error}
            onCancel={close}
            onSubmit={(v) => save.mutate({ id: editing.id, ...v })}
          />
        )}
      </ResponsiveDialog>

      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && close()}
        title={deleting ? `Delete ${deleting.name}?` : "Delete tag"}
        description="It's removed from every transaction and from any rules that add it."
      >
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Used on {plural(deleting.txnCount)}. The transactions themselves are not affected.
            </p>
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
              <Button variant="outline" className="h-11 md:h-9" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="h-11 md:h-9"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting)}
              >
                {remove.isPending && <Loader2 className="animate-spin" />} Delete
              </Button>
            </div>
          </div>
        )}
      </ResponsiveDialog>
    </Card>
  );
}

function TagForm({
  tag,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  tag: TagAdminRow;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (v: { name: string; color: string }) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, color });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="tag-name">Name</Label>
        <Input
          id="tag-name"
          value={name}
          maxLength={40}
          required
          autoFocus
          onChange={(e) => setName(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="space-y-2">
        <Label>Color</Label>
        <div role="radiogroup" aria-label="Tag color" className="flex flex-wrap gap-2">
          {[...new Set([tag.color, ...CHART_PALETTE])].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                "size-9 rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                color === c ? "scale-110 border-foreground" : "border-transparent",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 md:h-9" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}
