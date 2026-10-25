"use client";

import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AiPanel } from "@/components/ai/ai-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { InsightsPayload } from "@/lib/insights/types";
import { InsightCard } from "./insight-card";

export const INSIGHTS_KEY = ["insights"] as const;

export function InsightsPage() {
  const query = useQuery({
    queryKey: INSIGHTS_KEY,
    queryFn: () => fetchJson<InsightsPayload>("/api/insights"),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Things worth a look, worked out from your own transactions. Insights are computed on your own server.
        </p>
      </div>

      <AiPanel />

      {query.isPending ? (
        <div className="space-y-3" aria-busy aria-label="Loading insights">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load insights.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : query.data.insights.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="Nothing notable right now. Insights show up as your spending patterns change."
        />
      ) : (
        <ul className="space-y-3" data-testid="insights-list">
          {query.data.insights.map((i) => (
            <li key={i.id}>
              <InsightCard insight={i} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
