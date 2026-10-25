"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { LazyMount } from "@/components/lazy-mount";
import { CardBoundary } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/hooks/use-lookups";
import { fetchJson } from "@/lib/fetch-json";
import type { DashboardPayload } from "@/lib/finance/dashboard-types";
import { TargetsCard } from "@/components/targets/targets-card";
import { AccountBalancesCard } from "./account-balances-card";
import { InsightsTeaser } from "@/components/insights/insights-teaser";
import { MonthGlanceCard } from "./month-glance-card";
import { NetWorthCard } from "./net-worth-card";
import { RecentTransactionsCard } from "./recent-transactions-card";
import { UpcomingCard } from "./upcoming-card";

// These two draw with the charting library; their code only downloads when they scroll near the screen.
const SpendingPaceChart = dynamic(() => import("./spending-pace-chart").then((m) => m.SpendingPaceChart), {
  ssr: false,
});
const TopCategoriesCard = dynamic(() => import("./top-categories-card").then((m) => m.TopCategoriesCard), {
  ssr: false,
});

export const DASHBOARD_KEY = ["dashboard"] as const;

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-12" aria-busy aria-label="Loading dashboard">
      <Skeleton className="h-96 rounded-2xl lg:col-span-8" />
      <Skeleton className="h-96 rounded-2xl lg:col-span-4" />
      <Skeleton className="h-80 rounded-2xl lg:col-span-8" />
      <Skeleton className="h-80 rounded-2xl lg:col-span-4" />
    </div>
  );
}

export function Dashboard({ initialData }: { initialData?: DashboardPayload }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: () => fetchJson<DashboardPayload>("/api/dashboard"),
    staleTime: 30_000,
    // Rendered on the server for the first paint; the client takes over once it is stale.
    initialData,
  });
  const { data: categories = [] } = useCategories();

  if (isPending) return <DashboardSkeleton />;
  if (isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <span className="text-negative">Couldn&apos;t load your dashboard.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data.hasAccounts) {
    return (
      <EmptyState
        icon={CreditCard}
        title="Your net worth and monthly overview will show up here once accounts are connected."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/connections">Connect SimpleFIN</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
        <CardBoundary name="Net worth">
          <NetWorthCard summary={data.netWorth} />
        </CardBoundary>
      </div>
      <div className="min-w-0 lg:col-span-4">
        <CardBoundary name="This month">
          <MonthGlanceCard glance={data.glance} />
        </CardBoundary>
      </div>
      <div className="min-w-0 lg:col-span-8">
        <LazyMount minHeight={380}>
          <CardBoundary name="The spending chart">
            <SpendingPaceChart chart={data.spending} />
          </CardBoundary>
        </LazyMount>
      </div>
      <div className="min-w-0 lg:col-span-4">
        <LazyMount minHeight={380}>
          <CardBoundary name="Top categories">
            <TopCategoriesCard breakdown={data.categories} month={data.month} />
          </CardBoundary>
        </LazyMount>
      </div>
      <div className="min-w-0 lg:col-span-8">
        <LazyMount minHeight={420}>
          <CardBoundary name="Recent transactions">
            <RecentTransactionsCard rows={data.recent} categories={categories} />
          </CardBoundary>
        </LazyMount>
      </div>
      <div className="min-w-0 space-y-4 lg:col-span-4">
        <CardBoundary name="Targets">
          <TargetsCard targets={data.targets} month={data.month} />
        </CardBoundary>
        <LazyMount minHeight={200}>
          <CardBoundary name="Account balances">
            <AccountBalancesCard groups={data.accounts} />
          </CardBoundary>
        </LazyMount>
        <LazyMount minHeight={180}>
          <CardBoundary name="Upcoming charges">
            <UpcomingCard />
          </CardBoundary>
        </LazyMount>
        <LazyMount minHeight={220}>
          <CardBoundary name="Insights">
            <InsightsTeaser />
          </CardBoundary>
        </LazyMount>
      </div>
    </div>
  );
}
