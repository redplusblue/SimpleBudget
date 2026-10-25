"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TargetsCard } from "@/components/targets/targets-card";
import { LazyMount } from "@/components/lazy-mount";
import { CardBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { SpendingReport } from "@/lib/finance/spending-report-types";
import { AccountsCard, MerchantsCard, TagsCard } from "./breakdown-cards";
import { ComparisonCard } from "./comparison-card";
import { Heatmap } from "./heatmap";
import { RangePicker } from "./range-picker";
import { currentMonthLocal, parseRange, rangeQuery, type RangeState } from "./range-state";
import { RecurringCard } from "./recurring-card";
import { SummaryCards } from "./summary-cards";

function Skeletons() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading spending">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-2xl lg:col-span-7" />
        <Skeleton className="h-80 rounded-2xl lg:col-span-5" />
      </div>
    </div>
  );
}

// Chart-heavy sections download their code only when they scroll near the screen.
const CategoryBreakdown = dynamic(() => import("./category-breakdown").then((m) => m.CategoryBreakdown), {
  ssr: false,
});
const WeekdayChart = dynamic(() => import("./weekday-chart").then((m) => m.WeekdayChart), { ssr: false });
const TrendsChart = dynamic(() => import("./trends-chart").then((m) => m.TrendsChart), { ssr: false });

export function SpendingPage({ initial }: { initial?: { key: string; report: SpendingReport } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fallback = useMemo(() => currentMonthLocal(), []);
  const fromUrl = useMemo(() => parseRange(new URLSearchParams(params.toString()), fallback), [params, fallback]);
  // The page keeps its own copy so quick successive clicks (e.g. "next month" twice) build on each other instead of
  // all reading the address before the previous navigation has landed; browser back/forward still wins.
  const [range, setRangeState] = useState<RangeState>(fromUrl);
  const fromUrlKey = rangeQuery(fromUrl);
  useEffect(() => setRangeState(fromUrl), [fromUrlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRange = useCallback(
    (next: RangeState) => {
      setRangeState(next);
      router.replace(`${pathname}?${rangeQuery(next)}`, { scroll: false });
    },
    [router, pathname],
  );

  const { data, isPending, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ["spending", rangeQuery(range)],
    queryFn: () => fetchJson<SpendingReport>(`/api/spending?${rangeQuery(range)}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // The server already computed the report for the address the page was opened with.
    initialData: initial && initial.key === rangeQuery(range) ? initial.report : undefined,
  });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Spending</h1>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {isPending ? (
        <Skeletons />
      ) : isError && !data ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load spending for this range.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div
          className="space-y-4"
          aria-busy={isPlaceholderData}
          style={{ opacity: isPlaceholderData ? 0.6 : 1, transition: "opacity 150ms" }}
        >
          <p className="text-sm text-muted-foreground" data-testid="range-summary">
            {data.range.label}
            {data.range.isCurrent ? ` · ${data.range.elapsedDays} of ${data.range.days} days so far` : ""}
            {` · compared with ${data.range.previous.label}`}
          </p>
          <CardBoundary name="The summary">
            <SummaryCards range={data.range} summary={data.summary} />
          </CardBoundary>
          {data.range.month && <TargetsCard targets={data.targets} month={data.range.month} />}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <CardBoundary name="The comparison">
                <ComparisonCard range={data.range} rows={data.comparison} />
              </CardBoundary>
            </div>
            <div className="min-w-0 lg:col-span-5">
              <CardBoundary name="The calendar">
                <Heatmap days={data.daily} />
              </CardBoundary>
            </div>
            <div className="min-w-0 lg:col-span-7">
              <LazyMount minHeight={420}>
                <CardBoundary name="Categories">
                  <CategoryBreakdown range={data.range} rows={data.categories} totalCents={data.summary.spentCents} />
                </CardBoundary>
              </LazyMount>
            </div>
            <div className="min-w-0 space-y-4 lg:col-span-5">
              <CardBoundary name="Tags">
                <TagsCard range={data.range} rows={data.tags} />
              </CardBoundary>
              <CardBoundary name="Accounts">
                <AccountsCard range={data.range} rows={data.accounts} />
              </CardBoundary>
            </div>
            <div className="min-w-0 lg:col-span-7">
              <CardBoundary name="Merchants">
                <MerchantsCard range={data.range} rows={data.merchants} />
              </CardBoundary>
            </div>
            <div className="min-w-0 lg:col-span-5">
              <LazyMount minHeight={300}>
                <CardBoundary name="The weekday chart">
                  <WeekdayChart rows={data.weekdays} />
                </CardBoundary>
              </LazyMount>
            </div>
            <div className="min-w-0 lg:col-span-12">
              <LazyMount minHeight={380}>
                <CardBoundary name="The trend chart">
                  <TrendsChart trends={data.trends} />
                </CardBoundary>
              </LazyMount>
            </div>
            <div className="min-w-0 lg:col-span-12">
              <CardBoundary name="Recurring charges">
                <RecurringCard />
              </CardBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
