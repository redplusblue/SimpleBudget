import { format } from "date-fns";
import { ArrowLeftRight, ArrowRight, ReceiptText } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CategoryOption } from "@/lib/finance/taxonomy";
import type { TransactionRow } from "@/lib/finance/transaction-types";

export function RecentTransactionsCard({ rows, categories }: { rows: TransactionRow[]; categories: CategoryOption[] }) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return (
    <Card className="h-full" aria-labelledby="recent-title">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="recent-title" className="text-sm font-medium text-muted-foreground">
            Recent transactions
          </h2>
          <Link
            href="/transactions"
            className="inline-flex min-h-8 items-center gap-1 text-sm text-link underline-offset-4 hover:underline"
          >
            View all <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        {rows.length === 0 ? (
          <div className="grid h-40 place-items-center gap-2 rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            <ReceiptText className="size-6" aria-hidden />
            Transactions will show up here after your first sync.
          </div>
        ) : (
          <ul className="-mx-2 divide-y divide-border/60" data-testid="recent-list">
            {rows.map((r) => {
              const cat = r.categoryId ? byId.get(r.categoryId) : undefined;
              return (
                <li key={r.id}>
                  <Link
                    href={`/accounts/${encodeURIComponent(r.accountId)}`}
                    className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{r.displayPayee}</span>
                        {r.pending && (
                          <Badge
                            variant="outline"
                            className="h-5 shrink-0 border-warning/40 px-1.5 text-[10px] text-warning"
                          >
                            Pending
                          </Badge>
                        )}
                        {r.isTransfer && (
                          <ArrowLeftRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="Transfer" />
                        )}
                      </p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        {r.pending ? "Pending" : format(new Date(r.effectiveDate * 1000), "MMM d")} · {r.accountName}
                        {cat && (
                          <>
                            {" · "}
                            <span
                              aria-hidden
                              className="inline-block size-1.5 rounded-full"
                              style={{ background: cat.color }}
                            />
                            {cat.name}
                          </>
                        )}
                      </p>
                    </div>
                    <Money cents={r.amountCents} currency={r.currency} colorize className="shrink-0 font-medium" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
