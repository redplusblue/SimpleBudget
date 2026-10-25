import { Lightbulb } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { Insight } from "@/lib/insights/types";
import { InsightCard } from "./insight-card";

/** The three most important insights, on the dashboard. */
export function InsightsTeaser({ top, total }: { top: Insight[]; total: number }) {
  return (
    <Card aria-labelledby="insights-title">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="insights-title" className="text-sm font-medium text-muted-foreground">
            Insights
          </h2>
          <Link href="/insights" className="text-sm text-primary underline-offset-4 hover:underline">
            {total > top.length ? `See all ${total}` : "Details"}
          </Link>
        </div>
        {top.length === 0 ? (
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
