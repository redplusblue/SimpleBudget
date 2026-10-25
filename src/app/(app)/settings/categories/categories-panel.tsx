"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, GitMerge, Loader2, MoreHorizontal, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CategoryBadge } from "@/components/category-icon";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { SortableList } from "@/components/sortable-list";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import type { CategoryAdminRow } from "@/lib/finance/taxonomy-schemas";
import { CategoryForm, type CategoryFormValues } from "./category-form";

const KEY = ["categories-admin"] as const;
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; row: CategoryAdminRow }
  | { kind: "merge"; row: CategoryAdminRow }
  | { kind: "delete"; row: CategoryAdminRow }
  | null;

export function CategoriesPanel() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTaxonomy();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ categories: CategoryAdminRow[] }>("/api/categories/admin")).categories,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const groups = useMemo(() => [...new Set(rows.flatMap((r) => (r.groupName ? [r.groupName] : [])))].sort(), [rows]);

  const close = () => {
    setDialog(null);
    setError(null);
  };
  const onError = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong");

  const save = useMutation({
    mutationFn: (v: { values: CategoryFormValues; id?: number }) =>
      v.id === undefined
        ? fetchJson("/api/categories", jsonBody("POST", v.values))
        : fetchJson(`/api/categories/${v.id}`, jsonBody("PATCH", v.values)),
    onSuccess: () => {
      invalidate();
      close();
    },
    onError,
  });

  const archive = useMutation({
    mutationFn: (r: CategoryAdminRow) =>
      fetchJson(`/api/categories/${r.id}`, jsonBody("PATCH", { isArchived: !r.isArchived })),
    onSuccess: (_d, r) => {
      invalidate();
      toast.success(r.isArchived ? `Restored ${r.name}` : `Archived ${r.name}`);
    },
    onError: () => toast.error("Couldn't update that category"),
  });

  const merge = useMutation({
    mutationFn: (v: { from: CategoryAdminRow; intoId: number }) =>
      fetchJson<{ moved: number }>(`/api/categories/${v.from.id}/merge`, jsonBody("POST", { intoId: v.intoId })),
    onSuccess: ({ moved }, v) => {
      invalidate();
      toast.success(`Moved ${plural(moved, "transaction")} out of ${v.from.name}`);
      close();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (r: CategoryAdminRow) =>
      fetchJson<{ uncategorized: number }>(`/api/categories/${r.id}`, { method: "DELETE" }),
    onSuccess: (res, r) => {
      invalidate();
      toast.success(`Deleted ${r.name}`, {
        description: res.uncategorized
          ? `${plural(res.uncategorized, "transaction")} are now uncategorized.`
          : undefined,
      });
      close();
    },
    onError,
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => fetchJson("/api/categories/order", jsonBody("PUT", { ids })),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<CategoryAdminRow[]>(KEY);
      if (prev)
        qc.setQueryData(
          KEY,
          ids.flatMap((id) => prev.find((r) => r.id === id) ?? []),
        );
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error("Couldn't save the new order");
    },
    onSettled: invalidate,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>
          Optional labels for your spending. Drag to reorder; archive what you no longer use, or merge duplicates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load categories.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories. SimpleBudget works fine without them; add some if you'd like to label spending."
          />
        ) : (
          <SortableList
            items={rows}
            getLabel={(r) => r.name}
            onReorder={(ids) => reorder.mutate(ids)}
            renderItem={(r, { handle }) => (
              <div
                data-testid="category-row"
                className={`flex items-center gap-2 rounded-xl border border-border bg-surface-2/40 p-2.5 ${r.isArchived ? "opacity-60" : ""}`}
              >
                {handle}
                <CategoryBadge icon={r.icon} color={r.color} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    <span className="truncate">{r.name}</span>
                    {r.isIncome && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        Income
                      </Badge>
                    )}
                    {r.isArchived && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        Archived
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs break-words text-muted-foreground">
                    {r.groupName ? `${r.groupName} · ` : ""}
                    {plural(r.txnCount, "transaction")}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 md:size-9"
                      aria-label={`Actions for ${r.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDialog({ kind: "edit", row: r })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => archive.mutate(r)}>
                      {r.isArchived ? <ArchiveRestore /> : <Archive />} {r.isArchived ? "Restore" : "Archive"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDialog({ kind: "merge", row: r })} disabled={rows.length < 2}>
                      <GitMerge /> Merge into…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete", row: r })}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          />
        )}
        <Button variant="outline" onClick={() => setDialog({ kind: "create" })} className="h-11 w-full md:h-9">
          <Plus /> Add category
        </Button>
      </CardContent>

      <ResponsiveDialog
        open={dialog?.kind === "create" || dialog?.kind === "edit"}
        onOpenChange={(o) => !o && close()}
        title={dialog?.kind === "edit" ? "Edit category" : "New category"}
        className="sm:max-w-xl"
      >
        {(dialog?.kind === "create" || dialog?.kind === "edit") && (
          <CategoryForm
            key={dialog.kind === "edit" ? dialog.row.id : "new"}
            initial={dialog.kind === "edit" ? dialog.row : undefined}
            groups={groups}
            busy={save.isPending}
            error={error}
            onCancel={close}
            onSubmit={(values) => save.mutate({ values, id: dialog.kind === "edit" ? dialog.row.id : undefined })}
          />
        )}
      </ResponsiveDialog>

      <MergeDialog
        row={dialog?.kind === "merge" ? dialog.row : null}
        options={rows}
        busy={merge.isPending}
        error={error}
        onCancel={close}
        onConfirm={(from, intoId) => merge.mutate({ from, intoId })}
      />

      <ResponsiveDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && close()}
        title={dialog?.kind === "delete" ? `Delete ${dialog.row.name}?` : "Delete category"}
        description="Its transactions stay, but become uncategorized. Rules that only set this category are removed."
      >
        {dialog?.kind === "delete" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {plural(dialog.row.txnCount, "transaction")} will become uncategorized. To keep them organized, merge into
              another category instead.
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
                onClick={() => remove.mutate(dialog.row)}
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

function MergeDialog({
  row,
  options,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  row: CategoryAdminRow | null;
  options: CategoryAdminRow[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (from: CategoryAdminRow, intoId: number) => void;
}) {
  const [target, setTarget] = useState<string>("");
  const targets = options.filter((o) => o.id !== row?.id);
  const chosen = targets.find((t) => String(t.id) === target);
  return (
    <ResponsiveDialog
      open={row !== null}
      onOpenChange={(o) => {
        if (!o) {
          setTarget("");
          onCancel();
        }
      }}
      title={row ? `Merge ${row.name}` : "Merge category"}
      description="Move everything into another category, then delete this one."
    >
      {row && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="merge-target" className="text-sm font-medium">
              Merge into
            </label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="merge-target" aria-label="Merge into" className="h-11 w-full md:h-9">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                    {t.isArchived ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {chosen
              ? `${plural(row.txnCount, "transaction")} will move from ${row.name} to ${chosen.name}, and ${row.name} will be deleted.`
              : "Pick the category that should keep the transactions."}
          </p>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="outline" className="h-11 md:h-9" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="h-11 md:h-9"
              disabled={!chosen || busy}
              onClick={() => chosen && onConfirm(row, chosen.id)}
            >
              {busy && <Loader2 className="animate-spin" />} Merge
            </Button>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}
