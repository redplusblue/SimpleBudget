"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import { useState } from "react";

interface Counts {
  matched: number;
  changed: number;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export interface ApplyTarget {
  /** Omit to run every enabled rule. */
  ruleId?: number;
  title: string;
}

/** Runs one rule (or all of them) over existing transactions, showing what would change before doing it. */
export function ApplyDialog({ target, onClose }: { target: ApplyTarget | null; onClose: () => void }) {
  return (
    <ResponsiveDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={target?.title ?? "Apply rules"}
      description="By default only empty categories and names are filled in; anything you've already set is left alone."
    >
      {target && <ApplyForm key={target.ruleId ?? "all"} target={target} onClose={onClose} />}
    </ResponsiveDialog>
  );
}

function ApplyForm({ target, onClose }: { target: ApplyTarget; onClose: () => void }) {
  const [overwrite, setOverwrite] = useState(false);
  const invalidate = useInvalidateTaxonomy();
  const body = (dryRun: boolean) => jsonBody("POST", { ruleId: target.ruleId, overwrite, dryRun });

  const preview = useQuery({
    queryKey: ["rule-apply-preview", target.ruleId ?? "all", overwrite],
    queryFn: () => fetchJson<Counts>("/api/rules/apply", body(true)),
    staleTime: 0,
  });
  const run = useMutation({
    mutationFn: () => fetchJson<Counts>("/api/rules/apply", body(false)),
    onSuccess: (res) => {
      invalidate();
      toast.success(res.changed === 0 ? "Nothing needed changing" : `Updated ${plural(res.changed, "transaction")}`);
      onClose();
    },
    onError: () => toast.error("Couldn't apply the rules"),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm" aria-live="polite" data-testid="apply-summary">
        {preview.isPending ? (
          "Checking…"
        ) : preview.isError ? (
          <span className="text-negative">Couldn&apos;t check what this would do.</span>
        ) : (
          <>
            <span className="font-medium">{plural(preview.data.matched, "transaction")}</span> match, and{" "}
            <span className="font-medium">{preview.data.changed.toLocaleString()}</span> would be updated.
          </>
        )}
      </p>
      <div className="flex items-start gap-2">
        <Checkbox
          id="apply-overwrite"
          checked={overwrite}
          onCheckedChange={(v) => setOverwrite(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="apply-overwrite" className="flex-col items-start gap-0.5 text-sm font-normal">
          Replace values that are already set
          <span className="text-xs text-muted-foreground">
            Categories and payee names you chose yourself will be overwritten.
          </span>
        </Label>
      </div>
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button variant="outline" className="h-11 md:h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="h-11 md:h-9"
          disabled={run.isPending || preview.isPending || preview.isError || (preview.data?.changed ?? 0) === 0}
          onClick={() => run.mutate()}
        >
          {run.isPending && <Loader2 className="animate-spin" />} Apply
        </Button>
      </div>
    </div>
  );
}
