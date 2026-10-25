"use client";

import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { InsightsPayload } from "@/lib/insights/types";
import { InsightCard } from "./insight-card";
import { INSIGHTS_KEY } from "./keys";

const TEASER_COUNT = 3;

/** The three most important insights, on the dashboard. Fetched when the card scrolls into view. */
export function InsightsTeaser() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: INSIGHTS_KEY,
    queryFn: () => fetchJson<InsightsPayload>("/api/insights"),
    staleTime: 30_000,
  });
  const top = data?.insights.slice(0, TEASER_COUNT) ?? [];
  const total = data?.insights.length ?? 0;
  return (
    <Card aria-labelledby="insights-title">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="insights-title" className="text-sm font-medium text-muted-foreground">
            Insights
          </h2>
          <Link href="/insights" className="text-sm text-link underline-offset-4 hover:underline">
            {total > top.length ? `See all ${total}` : "Details"}
          </Link>
        </div>
        {isPending ? (
          <div className="space-y-2" aria-busy aria-label="Loading insights">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load insights.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : top.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
              <Lightbulb className="size-4" aria-hidden />
            </span>
            Nothing notable right now.
          </div>
        ) : (
          <ul data-testid="insights-teaser" className="-mx-1 divide-y divide-border/60 px-1">
            {top.map((i) => (
              <li key={i.id}>
                <InsightCard insight={i} compact />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
