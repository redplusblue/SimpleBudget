"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, MoreHorizontal, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CategoryBadge } from "@/components/category-icon";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { TargetDialog, type TargetDialogState } from "@/components/targets/target-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { fetchJson } from "@/lib/fetch-json";
import type { TargetRow } from "@/lib/finance/targets-types";

export const TARGETS_KEY = ["targets"] as const;

const monthName = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return format(new Date(y, mo - 1, 1), "MMMM yyyy");
};

export function TargetsPanel() {
  const invalidate = useInvalidateTaxonomy();
  const [dialog, setDialog] = useState<TargetDialogState | null>(null);
  const [deleting, setDeleting] = useState<TargetRow | null>(null);
  const query = useQuery({
    queryKey: TARGETS_KEY,
    queryFn: async () => (await fetchJson<{ targets: TargetRow[] }>("/api/targets")).targets,
  });

  const remove = useMutation({
    mutationFn: (t: TargetRow) => fetchJson(`/api/targets/${t.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Target removed");
      setDeleting(null);
    },
    onError: () => toast.error("Couldn't remove that target"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending targets</CardTitle>
        <CardDescription>
          Optional monthly limits for a category or tag, shown as progress on your dashboard and Spending page. They
          never block anything. You can also add one from a category or tag&apos;s menu.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <div className="space-y-2" aria-busy>
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load targets.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : query.data.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No targets. Targets are entirely optional; add one if you'd like to keep an eye on a category."
          />
        ) : (
          <ul className="space-y-2">
            {query.data.map((t) => (
              <li
                key={t.id}
                data-testid="target-setting"
                className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 p-2.5"
              >
                {t.kind === "category" ? (
                  <CategoryBadge icon={t.subjectIcon} color={t.subjectColor} />
                ) : (
                  <span
                    aria-hidden
                    className="mx-3 size-3 shrink-0 rounded-full"
                    style={{ background: t.subjectColor }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {t.subjectName}{" "}
                    <span className="text-xs font-normal text-muted-foreground">{t.kind === "tag" ? "tag" : ""}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.month === null ? "Every month" : `${monthName(t.month)} only`}
                  </p>
                </div>
                <Money cents={t.amountCents} className="shrink-0 text-sm font-semibold" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 md:size-9"
                      aria-label={`Actions for the ${t.subjectName} target`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDialog({ target: t })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(t)}>
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={() => setDialog({})} className="h-11 w-full md:h-9">
          <Plus /> Add target
        </Button>
      </CardContent>

      <TargetDialog state={dialog} onClose={() => setDialog(null)} />
      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this target?"
        description="Your transactions aren't affected."
      >
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-11 md:h-9"
            disabled={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting)}
          >
            {remove.isPending && <Loader2 className="animate-spin" />} Remove
          </Button>
        </div>
      </ResponsiveDialog>
    </Card>
  );
}
