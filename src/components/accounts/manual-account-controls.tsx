"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRefreshMoney } from "@/hooks/use-refresh-money";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";

/** Set-the-balance and delete controls, shown in the settings of a manual account. */
export function ManualAccountControls({
  accountId,
  balanceCents,
  onClose,
}: {
  accountId: string;
  balanceCents: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const refresh = useRefreshMoney();
  const [balance, setBalance] = useState(centsToDecimalString(balanceCents));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setBal = useMutation({
    mutationFn: async () => {
      let cents: number;
      try {
        cents = parseCents(balance.trim().replace(/^\$/, ""));
      } catch {
        throw new Error("Enter a balance like 200 or 200.00");
      }
      return fetchJson(
        `/api/accounts/${encodeURIComponent(accountId)}/balance`,
        jsonBody("PUT", { balanceCents: cents }),
      );
    },
    onSuccess: () => {
      refresh();
      toast.success("Balance updated");
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't update the balance"),
  });

  const remove = useMutation({
    mutationFn: () => fetchJson(`/api/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast.success("Account deleted");
      onClose();
      router.push("/accounts");
    },
    onError: () => setError("Couldn't delete the account"),
  });

  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-testid="manual-controls">
      <div className="space-y-2">
        <Label htmlFor="manual-set-balance">Balance ($)</Label>
        <div className="flex gap-2">
          <Input
            id="manual-set-balance"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="h-11 md:h-9"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            disabled={setBal.isPending}
            onClick={() => (setError(null), setBal.mutate())}
          >
            {setBal.isPending && <Loader2 className="animate-spin" />} Set balance
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Adding or editing a transaction moves the balance for you. Use this after counting what you actually have.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Delete this account and all its transactions?</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Loader2 className="animate-spin" />} Delete
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-negative"
          onClick={() => setConfirming(true)}
        >
          Delete account…
        </Button>
      )}
    </div>
  );
}
