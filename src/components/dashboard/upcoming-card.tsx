"use client";

import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import { Card, CardContent } from "@/components/ui/card";
import type { UpcomingSummary } from "@/lib/finance/dashboard-types";
import { cn } from "@/lib/utils";

export const UPCOMING_KEY = ["upcoming"] as const;

function when(inDays: number): { text: string; late: boolean } {
  if (inDays < 0) return { text: `${-inDays} day${inDays === -1 ? "" : "s"} late`, late: true };
  if (inDays === 0) return { text: "today", late: false };
  if (inDays === 1) return { text: "tomorrow", late: false };
  return { text: `in ${inDays} days`, late: false };
}

/** The next recurring charges, from the detector (subscriptions and regular bills). */
export function UpcomingCard() {
  const {
    data: upcoming,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: UPCOMING_KEY,
    queryFn: () => fetchJson<UpcomingSummary>("/api/dashboard/upcoming"),
    staleTime: 60_000,
  });
  return (
    <Card aria-labelledby="upcoming-title">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="upcoming-title" className="text-sm font-medium text-muted-foreground">
            Upcoming
          </h2>
          <Link href="/spending#recurring" className="text-sm text-link underline-offset-4 hover:underline">
            All recurring
          </Link>
        </div>
        {isPending ? (
          <div className="space-y-2" aria-busy aria-label="Loading upcoming charges">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load upcoming charges.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : upcoming.items.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
              <CalendarClock className="size-4" aria-hidden />
            </span>
            {upcoming.activeCount === 0
              ? "Subscriptions and regular bills will appear here once they're detected."
              : "Nothing is due in the next 30 days."}
          </div>
        ) : (
          <ul data-testid="upcoming-list" className="-mx-2 divide-y divide-border/60">
            {upcoming.items.map((u) => {
              const w = when(u.inDays);
              return (
                <li key={u.key} className="flex min-h-12 items-center gap-3 px-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{u.name}</span>
                      {u.increasePct !== null && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                          title="The price went up"
                        >
                          <ArrowUpRight className="size-3" aria-hidden /> Price up
                        </span>
                      )}
                    </p>
                    <p className={cn("text-xs", w.late ? "text-warning" : "text-muted-foreground")}>
                      {format(parseISO(u.nextDate), "MMM d")} · {w.text}
                    </p>
                  </div>
                  <Money cents={-u.amountCents} className="shrink-0 text-sm font-medium" />
                </li>
              );
            })}
          </ul>
        )}
        {upcoming && upcoming.activeCount > 0 && (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            About <Money cents={upcoming.monthlyTotalCents} className="font-medium text-foreground" /> a month across{" "}
            {upcoming.activeCount} recurring charge{upcoming.activeCount === 1 ? "" : "s"}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
