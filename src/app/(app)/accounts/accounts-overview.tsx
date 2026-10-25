"use client";

import { CreditCard, Plus } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { ManualAccountDialog } from "@/components/accounts/manual-account-dialog";
import { AccountCard } from "@/components/accounts/account-card";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountsOverview } from "@/hooks/use-lookups";

export function AccountsOverview() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button variant="outline" className="h-11 md:h-9" onClick={() => setAdding(true)}>
          <Plus /> Add manual account
        </Button>
      </div>
      <Overview />
      <ManualAccountDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

function Overview() {
  const { data, isPending, isError, refetch } = useAccountsOverview();

  if (isPending) {
    return (
      <div className="space-y-6" aria-busy>
        {[3, 2].map((n, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: n }).map((_, j) => (
              <Skeleton key={j} className="h-[72px] w-full rounded-2xl" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <span className="text-negative">Couldn&apos;t load your accounts.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No accounts yet. Connect SimpleFIN to import your accounts, or add a manual account."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/connections">Connect SimpleFIN</Link>
          </Button>
        }
      />
    );
  }

  const open = data.filter((g) => g.key !== "closed");
  const closed = data.find((g) => g.key === "closed");

  return (
    <div className="space-y-8">
      {open.map((g) => (
        <section key={g.key} aria-labelledby={`group-${g.key}`} className="space-y-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 id={`group-${g.key}`} className="text-sm font-medium text-muted-foreground">
              {g.label}
            </h2>
            <Money cents={g.totalCents} className="text-sm font-semibold" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {g.accounts.map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        </section>
      ))}
      {closed && (
        <details className="group space-y-3">
          <summary className="cursor-pointer px-1 text-sm font-medium text-muted-foreground">
            Closed accounts ({closed.accounts.length})
          </summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {closed.accounts.map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
