"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FEATURE_LABELS, type AiFeature } from "@/lib/llm/models";
import { fetchJson } from "@/lib/fetch-json";
import type { UsageReport } from "@/lib/llm/runs";

export const AI_USAGE_KEY = ["ai-usage"] as const;

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const label = (f: string) => FEATURE_LABELS[f as AiFeature] ?? f;

export function AiUsageCard() {
  const query = useQuery({
    queryKey: AI_USAGE_KEY,
    queryFn: async () => (await fetchJson<{ usage: UsageReport }>("/api/ai/usage")).usage,
  });
  const usage = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI usage this month</CardTitle>
        <CardDescription>
          Costs are the provider&apos;s figure when it reports one, otherwise an estimate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending && <Skeleton className="h-32 w-full rounded-xl" aria-busy />}
        {query.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load the usage.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {usage && usage.recent.length === 0 && (
          <p className="text-sm text-muted-foreground">No AI requests this month.</p>
        )}
        {usage && usage.recent.length > 0 && (
          <>
            <div>
              <p className="text-sm">
                <strong>{dollars(usage.spentMicros)}</strong>
                {usage.budgetMicros === null ? " spent, no monthly cap" : ` of ${dollars(usage.budgetMicros)} budget`}
                {usage.over && <span className="text-negative"> (budget used up)</span>}
              </p>
              {usage.budgetMicros !== null && usage.budgetMicros > 0 && (
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
                  role="progressbar"
                  aria-label="Share of the monthly AI budget used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.round((usage.spentMicros / usage.budgetMicros) * 100))}
                >
                  <div
                    className={usage.over ? "h-full bg-negative" : "h-full bg-link"}
                    style={{ width: `${Math.min(100, (usage.spentMicros / usage.budgetMicros) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            <ul className="space-y-1 text-sm">
              {usage.byFeature.map((f) => (
                <li key={f.feature} className="flex justify-between gap-3">
                  <span>{label(f.feature)}</span>
                  <span className="text-muted-foreground">
                    {f.runs} run{f.runs === 1 ? "" : "s"}, {f.tokens.toLocaleString()} tokens, {dollars(f.costMicros)}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="divide-y divide-border text-xs" aria-label="Recent AI requests">
              {usage.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-x-3 py-1.5">
                  <span className="min-w-0 break-words">
                    {new Date(r.startedAt * 1000).toLocaleString()} · {label(r.feature)} · {r.model}
                  </span>
                  <span className="text-muted-foreground">
                    {(r.promptTokens + r.completionTokens).toLocaleString()} tok ·{" "}
                    {r.costMicros === null ? "n/a" : `${dollars(r.costMicros)}${r.costEstimated ? " est." : ""}`} ·{" "}
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
