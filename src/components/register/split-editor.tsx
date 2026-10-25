"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { SplitPart } from "@/lib/finance/splits";
import type { CategoryOption } from "@/lib/finance/taxonomy";
import { CategorySelect } from "./category-select";
import { splitRemaining, type DraftPart } from "./split-math";

const splitsKey = (id: number) => ["splits", id] as const;

/** Splits a purchase across categories. The parts must add up to the amount before Save is allowed. */
export function SplitEditor({
  transactionId,
  amountCents,
  currency,
  categories,
}: {
  transactionId: number;
  amountCents: number;
  currency: string;
  categories: CategoryOption[];
}) {
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: splitsKey(transactionId),
    queryFn: async () => (await fetchJson<{ splits: SplitPart[] }>(`/api/transactions/${transactionId}/splits`)).splits,
  });
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const total = Math.abs(amountCents);

  const startEditing = () => {
    const existing = saved.data ?? [];
    setParts(
      existing.length
        ? existing.map((p) => ({
            categoryId: p.categoryId,
            amount: centsToDecimalString(Math.abs(p.amountCents)),
            notes: p.notes ?? "",
          }))
        : [
            { categoryId: null, amount: "", notes: "" },
            { categoryId: null, amount: "", notes: "" },
          ],
    );
    setError(null);
    setEditing(true);
  };
  // If the amount changed on the server (the bank revised it), the split is gone; leave edit mode.
  useEffect(() => setEditing(false), [transactionId, amountCents]);

  const { remainingCents, valid, centsList } = splitRemaining(parts, total, parseCents);

  const save = useMutation({
    mutationFn: (payload: { parts: Array<{ categoryId: number | null; amountCents: number; notes: string }> }) =>
      fetchJson(`/api/transactions/${transactionId}/splits`, jsonBody("PUT", payload)),
    onSuccess: () => {
      for (const key of [
        ["splits"],
        ["transaction"],
        ["transactions"],
        ["account"],
        ["dashboard"],
        ["spending"],
        ["targets"],
        ["insights"],
      ])
        qc.invalidateQueries({ queryKey: key });
      setEditing(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save the split"),
  });

  const sign = amountCents < 0 ? -1 : 1;
  const update = (i: number, patch: Partial<DraftPart>) =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  if (!editing) {
    const existing = saved.data ?? [];
    return (
      <div className="space-y-2">
        {existing.length > 0 && (
          <ul className="space-y-1 text-sm" data-testid="split-summary">
            {existing.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  {categories.find((c) => c.id === p.categoryId)?.name ?? "Uncategorized"}
                  {p.notes && <span className="text-muted-foreground"> · {p.notes}</span>}
                </span>
                <Money cents={p.amountCents} currency={currency} />
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={startEditing}
          disabled={saved.isPending || amountCents === 0}
        >
          <Scissors /> {existing.length ? "Edit split" : "Split across categories"}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      data-testid="split-editor"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate({
          parts: parts.map((p, i) => ({ categoryId: p.categoryId, amountCents: sign * centsList[i], notes: p.notes })),
        });
      }}
    >
      <ul className="space-y-3">
        {parts.map((p, i) => (
          <li key={i} className="space-y-1.5 rounded-xl border border-border p-2.5">
            <div className="flex items-center gap-2">
              <CategorySelect
                value={p.categoryId}
                categories={categories}
                onChange={(c) => update(i, { categoryId: c })}
                aria-label={`Category for part ${i + 1}`}
                className="flex-1"
              />
              <Input
                aria-label={`Amount for part ${i + 1}`}
                inputMode="decimal"
                placeholder="0.00"
                value={p.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                className="h-11 w-28 text-right md:h-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 md:size-9"
                aria-label={`Remove part ${i + 1}`}
                disabled={parts.length <= 2}
                onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Note for part ${i + 1}`}
                placeholder="Note (optional)"
                value={p.notes}
                maxLength={500}
                onChange={(e) => update(i, { notes: e.target.value })}
                className="h-9 flex-1 text-xs"
              />
              {remainingCents !== 0 && remainingCents > 0 && centsList[i] === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={() => update(i, { amount: centsToDecimalString(remainingCents) })}
                >
                  Use remaining
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2"
        disabled={parts.length >= 20}
        onClick={() => setParts((ps) => [...ps, { categoryId: null, amount: "", notes: "" }])}
      >
        <Plus /> Add part
      </Button>
      <p
        role="status"
        data-testid="split-remaining"
        className={remainingCents === 0 && valid ? "text-sm text-positive" : "text-sm text-muted-foreground"}
      >
        {remainingCents === 0 && valid ? (
          "Adds up to the full amount."
        ) : remainingCents > 0 ? (
          <>
            <Money cents={remainingCents} currency={currency} /> left to assign
          </>
        ) : (
          <>
            <Money cents={-remainingCents} currency={currency} /> too much
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11 md:h-9" disabled={!valid || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Save split
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {(saved.data?.length ?? 0) > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-negative md:h-9"
            disabled={save.isPending}
            onClick={() => save.mutate({ parts: [] }, { onSuccess: () => toast.success("Split removed") })}
          >
            Remove split
          </Button>
        )}
      </div>
    </form>
  );
}
