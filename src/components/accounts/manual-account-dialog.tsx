"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRefreshMoney } from "@/hooks/use-refresh-money";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { parseCents } from "@/lib/finance/cents";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/finance/account-types";

/** Creates an offline account such as a wallet or a cash envelope. */
export function ManualAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a manual account"
      description="For cash or anything that isn't connected to a bank. You keep it up to date by hand; syncing never touches it."
    >
      {open && <Form onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  );
}

function Form({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const refresh = useRefreshMoney();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("cash");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      let balanceCents = 0;
      if (balance.trim()) {
        try {
          balanceCents = parseCents(balance.trim().replace(/^\$/, ""));
        } catch {
          throw new Error("Enter a balance like 200 or 200.00");
        }
      }
      return fetchJson<{ id: string }>("/api/accounts", jsonBody("POST", { name, type, balanceCents }));
    },
    onSuccess: ({ id }) => {
      refresh();
      toast.success("Account added");
      onDone();
      router.push(`/accounts/${encodeURIComponent(id)}`);
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't add the account"),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="manual-name">Name</Label>
        <Input
          id="manual-name"
          value={name}
          maxLength={120}
          placeholder="e.g. Wallet"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="space-y-2">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
          <SelectTrigger aria-label="Account type" className="h-11 w-full md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="manual-balance">Current balance ($)</Label>
        <Input
          id="manual-balance"
          inputMode="decimal"
          placeholder="0.00"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          className="h-11 md:h-9"
        />
        <p className="text-xs text-muted-foreground">Use a negative number for money you owe.</p>
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
        <Button type="submit" className="h-11 md:h-9" disabled={create.isPending || !name.trim()}>
          {create.isPending && <Loader2 className="animate-spin" />} Add account
        </Button>
      </div>
    </form>
  );
}
