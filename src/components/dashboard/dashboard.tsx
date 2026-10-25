"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
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
import { SpendingPaceChart } from "./spending-pace-chart";
import { TopCategoriesCard } from "./top-categories-card";
import { UpcomingCard } from "./upcoming-card";

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

export function Dashboard() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: () => fetchJson<DashboardPayload>("/api/dashboard"),
    staleTime: 30_000,
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
        <NetWorthCard summary={data.netWorth} />
      </div>
      <div className="min-w-0 lg:col-span-4">
        <MonthGlanceCard glance={data.glance} />
      </div>
      <div className="min-w-0 lg:col-span-8">
        <SpendingPaceChart chart={data.spending} />
      </div>
      <div className="min-w-0 lg:col-span-4">
        <TopCategoriesCard breakdown={data.categories} month={data.month} />
      </div>
      <div className="min-w-0 lg:col-span-8">
        <RecentTransactionsCard rows={data.recent} categories={categories} />
      </div>
      <div className="min-w-0 space-y-4 lg:col-span-4">
        <TargetsCard targets={data.targets} month={data.month} />
        <AccountBalancesCard groups={data.accounts} />
        <UpcomingCard upcoming={data.upcoming} />
        <InsightsTeaser top={data.insights.top} total={data.insights.total} />
      </div>
    </div>
  );
}
