"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHART_PALETTE } from "@/db/palette";
import { fetchJson } from "@/lib/fetch-json";
import type { HoldingsSummary } from "@/lib/finance/holdings";
import { cn } from "@/lib/utils";

const pct = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(digits)}%`;

/** The positions inside an investment account. Shows nothing for accounts the bank reports no holdings for. */
export function HoldingsCard({ accountId, currency }: { accountId: string; currency: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["holdings", accountId],
    queryFn: () => fetchJson<HoldingsSummary>(`/api/accounts/${encodeURIComponent(accountId)}/holdings`),
    staleTime: 60_000,
  });
  if (isPending) return <Skeleton className="h-48 w-full rounded-2xl" aria-busy />;
  if (isError || data.holdings.length === 0) return null;

  return (
    <Card aria-labelledby="holdings-title">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="holdings-title" className="text-sm font-medium text-muted-foreground">
            Holdings
          </h2>
          <p className="text-sm">
            <Money cents={data.totalValueCents} currency={currency} className="font-semibold" />
            {data.totalGainCents !== null && data.totalGainPct !== null && (
              <span
                className={cn("ml-2", data.totalGainCents >= 0 ? "text-positive" : "text-negative")}
                data-testid="holdings-gain"
              >
                <Money cents={data.totalGainCents} currency={currency} sign="always" /> ({pct(data.totalGainPct)})
              </span>
            )}
          </p>
        </div>

        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={`Allocation: ${data.holdings.map((h) => `${h.symbol || h.description} ${(h.weight * 100).toFixed(0)} percent`).join(", ")}`}
        >
          {data.holdings.map((h, i) => (
            <div
              key={h.id}
              style={{ width: `${h.weight * 100}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] }}
            />
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-left text-sm" data-testid="holdings-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Holding
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Shares
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Value
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Gain / loss
                </th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h, i) => (
                <tr key={h.id} className="border-t border-border/60">
                  <th scope="row" className="py-2 pr-2 font-normal">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{h.symbol || "—"}</span>
                        <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
                          {h.description}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td className="py-2 text-right tabular-nums">
                    {Number(h.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-2 text-right">
                    <Money cents={h.marketValueCents} currency={h.currency} />
                    <span className="block text-xs text-muted-foreground">{(h.weight * 100).toFixed(1)}%</span>
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right",
                      h.gainCents === null
                        ? "text-muted-foreground"
                        : h.gainCents >= 0
                          ? "text-positive"
                          : "text-negative",
                    )}
                  >
                    {h.gainCents === null || h.gainPct === null ? (
                      "—"
                    ) : (
                      <>
                        <Money cents={h.gainCents} currency={h.currency} sign="always" />
                        <span className="block text-xs">{pct(h.gainPct)}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.asOf && (
          <p className="text-xs text-muted-foreground">
            As of {format(new Date(data.asOf * 1000), "MMM d, yyyy")}. Gain and loss use the cost basis your institution
            reports.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
