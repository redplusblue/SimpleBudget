"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { useCategories, useTags } from "@/hooks/use-lookups";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { TargetKind, TargetRow } from "@/lib/finance/targets-types";
import { MAX_TARGET_CENTS } from "@/lib/finance/targets-types";
import { format } from "date-fns";

export interface TargetDialogState {
  /** Editing an existing target. */
  target?: TargetRow;
  /** Starting a new target for a specific category or tag. */
  preset?: { kind: TargetKind; subjectId: number };
}

type Scope = "recurring" | "month";

const thisMonth = () => format(new Date(), "yyyy-MM");

/** Create or edit a monthly spending target for a category or a tag. */
export function TargetDialog({ state, onClose }: { state: TargetDialogState | null; onClose: () => void }) {
  return (
    <ResponsiveDialog
      open={state !== null}
      onOpenChange={(o) => !o && onClose()}
      title={state?.target ? "Edit target" : "New spending target"}
      description="A gentle limit to keep an eye on, not a hard budget. Spending is never blocked."
    >
      {state && (
        <TargetForm
          key={
            state.target
              ? `edit-${state.target.id}`
              : state.preset
                ? `new-${state.preset.kind}-${state.preset.subjectId}`
                : "new"
          }
          state={state}
          onClose={onClose}
        />
      )}
    </ResponsiveDialog>
  );
}

function TargetForm({ state, onClose }: { state: TargetDialogState; onClose: () => void }) {
  const existing = state.target;
  const invalidate = useInvalidateTaxonomy();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();

  const [kind, setKind] = useState<TargetKind>(existing?.kind ?? state.preset?.kind ?? "category");
  const [subjectId, setSubjectId] = useState<string>(String(existing?.subjectId ?? state.preset?.subjectId ?? ""));
  const [amount, setAmount] = useState(existing ? centsToDecimalString(existing.amountCents) : "");
  const [scope, setScope] = useState<Scope>(existing?.month ? "month" : "recurring");
  const [month, setMonth] = useState(existing?.month ?? thisMonth());
  const [error, setError] = useState<string | null>(null);

  const locked = existing !== undefined || state.preset !== undefined; // the subject is fixed when editing or opened from a menu
  const options = useMemo(
    () =>
      kind === "category"
        ? categories.filter((c) => !c.isArchived || String(c.id) === subjectId).map((c) => ({ id: c.id, name: c.name }))
        : tags.map((t) => ({ id: t.id, name: t.name })),
    [kind, categories, tags, subjectId],
  );
  const subjectName = options.find((o) => String(o.id) === subjectId)?.name ?? existing?.subjectName ?? "";

  const save = useMutation({
    mutationFn: async () => {
      let amountCents: number;
      try {
        amountCents = Math.abs(parseCents(amount.trim().replace(/^\$/, "")));
      } catch {
        throw new Error("Enter an amount like 400 or 400.00");
      }
      if (amountCents < 1) throw new Error("Enter an amount above zero");
      if (amountCents > MAX_TARGET_CENTS) throw new Error("That amount is too large");
      const monthValue = scope === "month" ? month : null;
      if (scope === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Choose a month");
      if (existing)
        return fetchJson(`/api/targets/${existing.id}`, jsonBody("PATCH", { amountCents, month: monthValue }));
      if (!subjectId) throw new Error("Choose a category or tag");
      return fetchJson(
        "/api/targets",
        jsonBody("POST", { kind, subjectId: Number(subjectId), amountCents, month: monthValue }),
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success(existing ? "Target updated" : "Target added");
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save the target"),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      {locked ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{kind === "category" ? "Category" : "Tag"}: </span>
          <span className="font-medium">{subjectName}</span>
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <Label>Applies to</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(v) => {
                if (v) {
                  setKind(v as TargetKind);
                  setSubjectId("");
                }
              }}
              aria-label="Target type"
              className="w-full"
            >
              <ToggleGroupItem value="category" className="h-11 flex-1 md:h-9">
                Category
              </ToggleGroupItem>
              <ToggleGroupItem value="tag" className="h-11 flex-1 md:h-9">
                Tag
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label>{kind === "category" ? "Category" : "Tag"}</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger aria-label={kind === "category" ? "Category" : "Tag"} className="h-11 w-full md:h-9">
                <SelectValue
                  placeholder={kind === "category" ? "Choose a category" : tags.length ? "Choose a tag" : "No tags yet"}
                />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="target-amount">Monthly limit ($)</Label>
        <Input
          id="target-amount"
          inputMode="decimal"
          placeholder="e.g. 400"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>

      <div className="space-y-2">
        <Label>When</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={scope}
          onValueChange={(v) => v && setScope(v as Scope)}
          aria-label="When the target applies"
          className="w-full"
        >
          <ToggleGroupItem value="recurring" className="h-11 flex-1 md:h-9">
            Every month
          </ToggleGroupItem>
          <ToggleGroupItem value="month" className="h-11 flex-1 md:h-9">
            One month only
          </ToggleGroupItem>
        </ToggleGroup>
        {scope === "month" && (
          <Input
            type="month"
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-11 md:h-9"
          />
        )}
        <p className="text-xs text-muted-foreground">
          {scope === "month"
            ? "A one-month target replaces the recurring one for that month."
            : "Applies to every month unless you set a one-month target."}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 md:h-9" disabled={save.isPending || !amount.trim()}>
          {save.isPending && <Loader2 className="animate-spin" />} {existing ? "Save" : "Add target"}
        </Button>
      </div>
    </form>
  );
}
