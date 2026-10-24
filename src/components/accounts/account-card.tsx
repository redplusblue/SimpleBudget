import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Sparkline } from "@/components/charts/sparkline";
import { Money } from "@/components/money";
import type { AccountOverviewItem } from "@/lib/finance/accounts-overview";
import { ACCOUNT_TYPE_LABELS } from "@/lib/finance/account-types";
import { cn } from "@/lib/utils";

export function AccountCard({ account: a }: { account: AccountOverviewItem }) {
  return (
    <Link
      href={`/accounts/${encodeURIComponent(a.id)}`}
      className={cn(
        "group flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        a.isClosed && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: a.color ?? "var(--brand-from)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{a.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {a.orgName} · {ACCOUNT_TYPE_LABELS[a.type]}
        </p>
        {a.stale && !a.isClosed && (
          <p className="mt-1 flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3 shrink-0" aria-hidden />
            {a.balanceDate
              ? `Balance from ${formatDistanceToNowStrict(a.balanceDate * 1000, { addSuffix: true })}`
              : "Balance never updated"}
          </p>
        )}
      </div>
      <Sparkline
        values={a.sparkline}
        className="hidden shrink-0 text-muted-foreground sm:block"
        label="Balance over the last 30 days"
      />
      <div className="text-right">
        <Money cents={a.balanceCents} currency={a.currency} className="text-base font-semibold tracking-tight" />
      </div>
    </Link>
  );
}
