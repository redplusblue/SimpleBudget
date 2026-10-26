"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Copy, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Money } from "@/components/money";
import { transactionsHref } from "@/components/spending/links";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { TraceReport } from "@/lib/finance/trace-types";
import { TraceExplain } from "./trace-explain";

const TraceChart = dynamic(() => import("./trace-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-40 w-full rounded-xl" aria-busy />,
});

export const traceKey = (id: number) => ["transaction-trace", id] as const;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function positionText(p: TraceReport["position"], count: number): string {
  if (count <= 1) return "The only one so far";
  if (p.isFirst) return "The first";
  if (p.isLargest) return "The largest";
  return `Larger than ${p.percentile}% of charges here`;
}

export function TracePanel({ id, onNavigate }: { id: number; onNavigate: (id: number) => void }) {
  const query = useQuery({
    queryKey: traceKey(id),
    queryFn: async () => (await fetchJson<{ trace: TraceReport }>(`/api/transactions/${id}/trace`)).trace,
  });

  if (query.isPending) return <Skeleton className="h-64 w-full rounded-xl" aria-busy />;
  if (query.isError)
    return (
      <div role="alert" className="flex items-center justify-between gap-3 text-sm">
        <span className="text-negative">Couldn&apos;t load this history.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  const t = query.data;
  const s = t.stats;
  const allHref = t.merchant.key ? transactionsHref({ merchant: t.merchant.key, merchantName: t.merchant.name }) : null;
  const hasSpend = t.byMonth.some((m) => m.spentCents > 0);
  const refs = [
    ...t.related.refunds.map((r) => ({ ...r, label: "Refund" })),
    ...t.related.possibleDuplicates.map((r) => ({ ...r, label: "Possible duplicate" })),
  ];

  return (
    <div className="space-y-4" data-testid="trace-panel">
      <div>
        <p className="font-medium">{t.merchant.name}</p>
        <p className="text-sm text-muted-foreground" data-testid="trace-count">
          {s.count} transaction{s.count === 1 ? "" : "s"} since {s.firstDate}
          {!t.merchant.key && " (this one has no merchant name to group by)"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Total spent">
          <Money cents={s.totalSpentCents} />
        </Stat>
        <Stat label="Last 12 months">
          <Money cents={s.last12MonthsSpentCents} />
        </Stat>
        <Stat label="Typical charge">
          <Money cents={s.medianCents} />
        </Stat>
        <Stat label="Range">
          <Money cents={s.minCents} /> – <Money cents={s.maxCents} />
        </Stat>
        <Stat label="Per active month">
          <Money cents={s.averageMonthlyCents} />
        </Stat>
        <Stat label="This charge">{positionText(t.position, s.count)}</Stat>
        {s.totalReceivedCents > 0 && (
          <Stat label="Received back">
            <Money cents={s.totalReceivedCents} />
          </Stat>
        )}
      </dl>

      {t.cadence && (
        <p className="text-sm">
          Repeats <strong>{t.cadence.cadence}</strong>
          {t.cadence.nextExpected && <> · next expected {t.cadence.nextExpected}</>}
        </p>
      )}
      {t.priceChanges.length > 0 && (
        <section aria-label="Price changes" className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Price changes</h3>
          <ul className="space-y-1 text-sm">
            {t.priceChanges.map((c) => (
              <li key={c.date}>
                {c.date}: <Money cents={c.fromCents} /> → <Money cents={c.toCents} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Last 24 months" className="space-y-1">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Last 24 months</h3>
        {hasSpend ? (
          <TraceChart months={t.byMonth} />
        ) : (
          <p className="text-sm text-muted-foreground">No spending in the last 24 months.</p>
        )}
      </section>

      {(refs.length > 0 || t.related.transferPair) && (
        <section aria-label="Related" className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Related</h3>
          <ul className="space-y-1">
            {refs.map((r) => (
              <li key={`${r.label}${r.id}`}>
                <button
                  type="button"
                  onClick={() => onNavigate(r.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-surface-2 p-2.5 text-left text-sm hover:bg-border md:min-h-0"
                >
                  {r.label === "Refund" ? (
                    <RotateCcw className="size-4 shrink-0" aria-hidden />
                  ) : (
                    <Copy className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {r.label} · {r.date}
                  </span>
                  <Money cents={r.amountCents} colorize />
                </button>
              </li>
            ))}
            {t.related.transferPair && (
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate(t.related.transferPair!.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-surface-2 p-2.5 text-left text-sm hover:bg-border md:min-h-0"
                >
                  <ArrowLeftRight className="size-4 shrink-0" aria-hidden /> The other side of this transfer
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      {t.similarMerchants.length > 0 && (
        <section aria-label="Also looks like" className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Also looks like</h3>
          <ul className="space-y-1 text-sm">
            {t.similarMerchants.map((m) => (
              <li key={m.key}>
                <Link
                  href={transactionsHref({ merchant: m.key, merchantName: m.name })}
                  className="text-link underline-offset-4 hover:underline"
                >
                  {m.name}
                </Link>{" "}
                <span className="text-muted-foreground">({m.count})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Categories and rule" className="space-y-1 text-sm">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Categories used</h3>
        <p>{t.categories.map((c) => `${c.name} (${c.count})`).join(", ")}</p>
        {t.rule ? (
          <p>
            Covered by rule{" "}
            <Link href="/rules" className="text-link underline-offset-4 hover:underline">
              {t.rule.name || "Untitled rule"}
            </Link>
            .
          </p>
        ) : (
          <p>
            No rule covers this merchant.{" "}
            <Link href={`/rules?from=${t.transactionId}`} className="text-link underline-offset-4 hover:underline">
              Create rule
            </Link>
          </p>
        )}
      </section>

      {allHref && (
        <Link href={allHref} className="inline-block text-sm text-link underline-offset-4 hover:underline">
          See all {s.count} transactions
        </Link>
      )}

      <TraceExplain id={id} />
    </div>
  );
}
