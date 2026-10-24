"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Money } from "@/components/money";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountsOverview } from "@/hooks/use-lookups";
import { cn } from "@/lib/utils";

/** Accounts grouped by type under the "Accounts" nav item (desktop sidebar only). */
export function SidebarAccounts() {
  const pathname = usePathname();
  const { data, isPending, isError } = useAccountsOverview();

  if (isPending) {
    return (
      <div className="space-y-1.5 py-1 pr-1 pl-9" aria-busy>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
    );
  }
  if (isError) return null;
  const groups = data.filter((g) => g.key !== "closed");
  if (groups.length === 0) return null;

  const rowClass = (active: boolean) =>
    cn(
      "flex items-center justify-between gap-2 rounded-md py-1 pr-2 pl-9 text-[13px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
      active && "bg-surface-2 text-foreground",
    );

  return (
    <div className="mb-1 space-y-2" aria-label="Your accounts" role="group">
      <Link
        href="/accounts"
        className={rowClass(pathname === "/accounts")}
        aria-current={pathname === "/accounts" ? "page" : undefined}
      >
        All accounts
      </Link>
      {groups.map((g) => (
        <div key={g.key}>
          <p className="pl-9 text-[11px] font-medium tracking-wide text-text-faint uppercase">{g.label}</p>
          {g.accounts.map((a) => {
            const href = `/accounts/${encodeURIComponent(a.id)}`;
            const active = pathname === href;
            return (
              <Link key={a.id} href={href} className={rowClass(active)} aria-current={active ? "page" : undefined}>
                <span className="truncate">{a.label}</span>
                <Money cents={a.balanceCents} currency={a.currency} compact className="shrink-0 text-xs" />
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
