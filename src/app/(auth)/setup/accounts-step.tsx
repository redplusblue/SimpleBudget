"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/finance/account-types";

interface AccountRow {
  id: string;
  orgName: string;
  name: string;
  displayName: string | null;
  currency: string;
  balanceCents: number;
  type: AccountType;
}

const KEY = ["accounts"] as const;

export function AccountsStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const [finishing, setFinishing] = useState(false);

  const accounts = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AccountRow[]> => {
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error("Failed to load accounts");
      return (await res.json()).accounts;
    },
  });

  const setType = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: AccountType }) => {
      const res = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error();
    },
    // Optimistic: flip the select immediately, roll back on failure.
    onMutate: async ({ id, type }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<AccountRow[]>(KEY);
      qc.setQueryData<AccountRow[]>(KEY, (rows) => rows?.map((r) => (r.id === id ? { ...r, type } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(KEY, ctx?.prev);
      toast.error("Couldn't change the account type");
    },
  });

  async function finish() {
    setFinishing(true);
    try {
      const res = await fetch("/api/setup/complete", { method: "POST" });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      toast.error("Couldn't finish setup.");
    } catch {
      toast.error("Couldn't reach the server.");
    }
    setFinishing(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Confirm your accounts</CardTitle>
        <CardDescription>
          We guessed each account&apos;s type from its name. Credit cards and loans count against your net worth.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {accounts.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : accounts.isError ? (
          <p role="alert" className="text-sm text-negative">
            Couldn&apos;t load your accounts.{" "}
            <button className="underline" onClick={() => accounts.refetch()}>
              Retry
            </button>
          </p>
        ) : (
          <ul className="space-y-2">
            {accounts.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/50 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.displayName ?? a.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.orgName} · <Money cents={a.balanceCents} currency={a.currency} />
                  </p>
                </div>
                <Select
                  value={a.type}
                  onValueChange={(type) => setType.mutate({ id: a.id, type: type as AccountType })}
                >
                  <SelectTrigger
                    aria-label={`Type of ${a.displayName ?? a.name}`}
                    className="h-11 w-full sm:h-9 sm:w-40"
                  >
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
              </li>
            ))}
          </ul>
        )}
        <Button
          onClick={finish}
          disabled={finishing || !accounts.data?.length}
          className="bg-brand-gradient h-11 w-full text-white md:h-9"
        >
          {finishing && <Loader2 className="animate-spin" />} Finish setup
        </Button>
      </CardContent>
    </Card>
  );
}
