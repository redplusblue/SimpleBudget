"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CategorySelect } from "@/components/register/category-select";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCategories } from "@/hooks/use-lookups";
import { useRefreshMoney } from "@/hooks/use-refresh-money";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import { localDateString } from "@/lib/finance/dates";

export interface ManualTxnDraft {
  id: number;
  date: string;
  amountCents: number;
  description: string;
  categoryId: number | null;
  notes: string | null;
}

/** Add a transaction to a manual account, or edit one you added earlier (`editing`). */
export function ManualTransactionDialog({
  accountId,
  open,
  onOpenChange,
  editing,
}: {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ManualTxnDraft;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit transaction" : "Add a transaction"}
      description="The account balance moves by the amount."
    >
      {open && (
        <Form key={editing?.id ?? "new"} accountId={accountId} editing={editing} onDone={() => onOpenChange(false)} />
      )}
    </ResponsiveDialog>
  );
}

function Form({ accountId, editing, onDone }: { accountId: string; editing?: ManualTxnDraft; onDone: () => void }) {
  const refresh = useRefreshMoney();
  const { data: categories = [] } = useCategories();
  const [kind, setKind] = useState<"expense" | "income">(editing && editing.amountCents > 0 ? "income" : "expense");
  const [date, setDate] = useState(editing?.date ?? format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState(editing ? centsToDecimalString(Math.abs(editing.amountCents)) : "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(editing?.categoryId ?? null);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let cents: number;
      try {
        cents = Math.abs(parseCents(amount.trim().replace(/^\$/, "")));
      } catch {
        throw new Error("Enter an amount like 12.50");
      }
      if (cents === 0) throw new Error("Enter an amount above zero");
      const body = { date, amountCents: kind === "expense" ? -cents : cents, description, categoryId, notes };
      return editing
        ? fetchJson(`/api/transactions/${editing.id}/manual`, jsonBody("PATCH", body))
        : fetchJson(`/api/accounts/${encodeURIComponent(accountId)}/transactions`, jsonBody("POST", body));
    },
    onSuccess: () => {
      refresh();
      toast.success(editing ? "Transaction updated" : "Transaction added");
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save the transaction"),
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
      <ToggleGroup
        type="single"
        variant="outline"
        value={kind}
        onValueChange={(v) => v && setKind(v as "expense" | "income")}
        aria-label="Money in or out"
        className="w-full"
      >
        <ToggleGroupItem value="expense" className="h-11 flex-1 md:h-9">
          Spent
        </ToggleGroupItem>
        <ToggleGroupItem value="income" className="h-11 flex-1 md:h-9">
          Received
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="mt-amount">Amount ($)</Label>
          <Input
            id="mt-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            className="h-11 md:h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mt-date">Date</Label>
          <Input
            id="mt-date"
            type="date"
            value={date}
            max={localDateString(Math.floor(Date.now() / 1000) + 86_400, "UTC")}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 md:h-9"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="mt-desc">Description</Label>
        <Input
          id="mt-desc"
          value={description}
          maxLength={200}
          placeholder="e.g. Taco truck"
          onChange={(e) => setDescription(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="space-y-2">
        <Label>Category</Label>
        <CategorySelect value={categoryId} categories={categories} onChange={setCategoryId} aria-label="Category" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mt-notes">Notes</Label>
        <Input
          id="mt-notes"
          value={notes}
          maxLength={2000}
          placeholder="Optional"
          onChange={(e) => setNotes(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 md:h-9"
          disabled={save.isPending || !amount.trim() || !description.trim()}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {editing ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
