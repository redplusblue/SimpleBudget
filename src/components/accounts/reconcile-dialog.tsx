"use client";

import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRefreshMoney } from "@/hooks/use-refresh-money";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { ReconcileResult } from "@/lib/finance/reconcile";

/** "Bank says $X, app says $Y": compare a statement balance with the transactions here, then sign off on a match. */
export function ReconcileDialog({
  accountId,
  currency,
  currentBalanceCents,
  open,
  onOpenChange,
}: {
  accountId: string;
  currency: string;
  currentBalanceCents: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reconcile"
      description="Enter the ending balance from your bank or statement. If it matches, you can mark everything up to that day as reviewed."
    >
      {open && (
        <Form
          accountId={accountId}
          currency={currency}
          currentBalanceCents={currentBalanceCents}
          onDone={() => onOpenChange(false)}
        />
      )}
    </ResponsiveDialog>
  );
}

function Form({
  accountId,
  currency,
  currentBalanceCents,
  onDone,
}: {
  accountId: string;
  currency: string;
  currentBalanceCents: number;
  onDone: () => void;
}) {
  const refresh = useRefreshMoney();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [balance, setBalance] = useState(centsToDecimalString(currentBalanceCents));
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (markReviewed: boolean) => {
      let balanceCents: number;
      try {
        balanceCents = parseCents(balance.trim().replace(/^\$/, ""));
      } catch {
        throw new Error("Enter a balance like 1250.00");
      }
      return (
        await fetchJson<{ result: ReconcileResult }>(
          `/api/accounts/${encodeURIComponent(accountId)}/reconcile`,
          jsonBody("POST", { date, balanceCents, markReviewed }),
        )
      ).result;
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.markedReviewed > 0) {
        refresh();
        toast.success(`Marked ${r.markedReviewed} transaction${r.markedReviewed === 1 ? "" : "s"} reviewed`);
      }
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't check the balance"),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setResult(null);
        run.mutate(false);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rec-date">Statement date</Label>
          <Input
            id="rec-date"
            type="date"
            value={date}
            onChange={(e) => (setDate(e.target.value), setResult(null))}
            className="h-11 md:h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-balance">Bank says ($)</Label>
          <Input
            id="rec-balance"
            inputMode="decimal"
            value={balance}
            onChange={(e) => (setBalance(e.target.value), setResult(null))}
            className="h-11 md:h-9"
          />
        </div>
      </div>

      {result && (
        <div data-testid="reconcile-result" className="space-y-2 rounded-xl border border-border p-3 text-sm">
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">Bank says</span>
            <Money cents={result.bankCents} currency={currency} className="font-medium" />
          </p>
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">App says</span>
            <Money cents={result.appCents} currency={currency} className="font-medium" />
          </p>
          {result.matches ? (
            <p className="flex items-center gap-2 text-positive">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden /> They match.
              {result.unreviewedCount === 0 && result.markedReviewed > 0
                ? " Everything up to that day is reviewed."
                : ""}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-negative">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Off by <Money cents={Math.abs(result.differenceCents)} currency={currency} /> (
                {result.differenceCents > 0 ? "the bank has more" : "the app has more"}). Look for a missing, duplicated
                or mistyped transaction around that date.
              </span>
            </p>
          )}
          {result.pendingCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {result.pendingCount} pending item{result.pendingCount === 1 ? " is" : "s are"} left out, as banks do.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Close
        </Button>
        {result?.matches && result.unreviewedCount > 0 && (
          <Button
            type="button"
            className="h-11 md:h-9"
            disabled={run.isPending}
            onClick={() => (setError(null), run.mutate(true))}
          >
            Mark {result.unreviewedCount} reviewed
          </Button>
        )}
        <Button type="submit" variant={result ? "outline" : "default"} className="h-11 md:h-9" disabled={run.isPending}>
          {run.isPending && <Loader2 className="animate-spin" />} Check
        </Button>
      </div>
    </form>
  );
}
