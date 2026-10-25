"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { BalanceChart } from "@/components/charts/balance-chart";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCountUp } from "@/hooks/use-count-up";
import { fetchJson } from "@/lib/fetch-json";
import {
  DEFAULT_NET_WORTH_RANGE,
  NET_WORTH_RANGES,
  type NetWorthRange,
  type NetWorthSummary,
} from "@/lib/finance/networth";
import { cn } from "@/lib/utils";
import { percent } from "./format";

const RANGE_LABELS: Record<NetWorthRange, string> = { "1M": "1M", "3M": "3M", "6M": "6M", "1Y": "1Y", ALL: "All" };

export function ChangeChip({ cents, ratio, label }: { cents: number | null; ratio: number | null; label: string }) {
  if (cents === null) return <span className="text-sm text-muted-foreground">{label}</span>;
  const up = cents >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span
        data-testid="nw-change"
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium",
          cents === 0
            ? "bg-surface-2 text-muted-foreground"
            : up
              ? "bg-positive/15 text-positive"
              : "bg-negative/15 text-negative",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        <Money cents={cents} sign="always" />
        {ratio !== null && (
          <span>
            ({up ? "+" : "−"}
            {percent(ratio)})
          </span>
        )}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function baselineLabel(s: NetWorthSummary): string {
  if (s.baselineKind === "30d") return "vs 30 days ago";
  if (s.baselineKind === "first" && s.baselineDate) return `since ${format(parseISO(s.baselineDate), "MMM d")}`;
  return "Not enough history yet";
}

/** Net worth hero: animated total, 30 day change, range-switchable area chart and an assets-vs-liabilities bar. */
export function NetWorthCard({ summary }: { summary: NetWorthSummary }) {
  const [range, setRange] = useState<NetWorthRange>(DEFAULT_NET_WORTH_RANGE);
  const animated = useCountUp(summary.totalCents);

  const series = useQuery({
    queryKey: ["networth", range],
    queryFn: () => fetchJson<NetWorthSummary>(`/api/networth?range=${range}`),
    // The dashboard payload already carries the default range, so there's nothing to fetch until the user changes it.
    initialData: range === DEFAULT_NET_WORTH_RANGE ? summary : undefined,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const gross = summary.assetsCents + summary.liabilitiesCents;
  const assetShare = gross === 0 ? 0 : (summary.assetsCents / gross) * 100;
  const days = NET_WORTH_RANGES[range];
  const loadingSeries = series.isPlaceholderData || series.isFetching;

  return (
    <Card className="h-full" aria-labelledby="net-worth-title">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 id="net-worth-title" className="text-sm font-medium text-muted-foreground">
              Net worth
            </h2>
            <Money cents={animated} className="hero-number block" />
            <ChangeChip cents={summary.changeCents} ratio={summary.changePct} label={baselineLabel(summary)} />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            value={range}
            onValueChange={(v) => v && setRange(v as NetWorthRange)}
            aria-label="Net worth range"
          >
            {(Object.keys(RANGE_LABELS) as NetWorthRange[]).map((r) => (
              <ToggleGroupItem key={r} value={r} className="h-9 min-w-10 px-2.5 text-xs md:h-8">
                {RANGE_LABELS[r]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <BalanceChart
          points={series.data?.series}
          loading={series.isPending}
          error={series.isError && !series.data}
          label="Net worth"
          tickFormat={days !== null && days <= 180 ? "MMM d" : "MMM yy"}
          height={220}
        />
        {summary.converted.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="fx-note">
            Includes accounts in {summary.converted.map((c) => c.currency).join(", ")}, converted to dollars at{" "}
            <Link href="/settings/currency" className="text-link underline-offset-4 hover:underline">
              the rates you set
            </Link>
            {summary.converted.some((c) => c.rate === null) ? " (no rate yet for some, so those count 1 to 1)" : ""}.
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {loadingSeries ? "Loading chart" : `Showing ${RANGE_LABELS[range]}`}
        </span>

        {gross > 0 && (
          <div className="space-y-2" data-testid="assets-liabilities">
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`Assets ${assetShare.toFixed(0)} percent, liabilities ${(100 - assetShare).toFixed(0)} percent`}
            >
              <div className="h-full bg-positive" style={{ width: `${assetShare}%` }} />
              <div className="h-full bg-negative/80" style={{ width: `${100 - assetShare}%` }} />
            </div>
            <div className="flex justify-between text-sm">
              <span>
                <span className="text-muted-foreground">Assets </span>
                <Money cents={summary.assetsCents} className="font-medium" />
              </span>
              <span>
                <span className="text-muted-foreground">Liabilities </span>
                <Money cents={summary.liabilitiesCents} className="font-medium" />
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
