import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import type { AccountGroup } from "@/lib/finance/accounts-overview";

export function AccountBalancesCard({ groups }: { groups: AccountGroup[] }) {
  const open = groups.filter((g) => g.key !== "closed");
  return (
    <Card aria-labelledby="balances-title">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="balances-title" className="text-sm font-medium text-muted-foreground">
            Accounts
          </h2>
          <Link href="/accounts" className="text-sm text-primary underline-offset-4 hover:underline">
            Details
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        ) : (
          <div className="space-y-3" data-testid="account-balances">
            {open.map((g) => (
              <div key={g.key}>
                <p className="px-2 text-[11px] font-medium tracking-wide text-text-faint uppercase">{g.label}</p>
                <ul>
                  {g.accounts.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/accounts/${encodeURIComponent(a.id)}`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: a.color ?? "var(--brand-from)" }}
                          />
                          <span className="truncate">{a.label}</span>
                          {a.stale && (
                            <AlertTriangle
                              className="size-3.5 shrink-0 text-warning"
                              aria-label="Balance may be out of date"
                            />
                          )}
                        </span>
                        <Money cents={a.balanceCents} currency={a.currency} className="shrink-0 font-medium" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
