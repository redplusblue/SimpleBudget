"use client";

import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { BalanceChart } from "@/components/charts/balance-chart";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { fetchJson } from "@/lib/fetch-json";
import type { Forecast } from "@/lib/finance/forecast-types";

function Tile({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tracking-tight">{children}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function ForecastPage() {
  const query = useQuery({
    queryKey: ["forecast"],
    queryFn: () => fetchJson<Forecast>("/api/forecast"),
    staleTime: 60_000,
  });
  const [withSpending, setWithSpending] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Forecast</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your cash over the next 30 days, from bills and income that repeat on a schedule.
        </p>
      </div>

      {query.isPending ? (
        <div className="space-y-4" aria-busy aria-label="Loading forecast">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load the forecast.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <ForecastBody data={query.data} withSpending={withSpending} setWithSpending={setWithSpending} />
      )}
    </div>
  );
}

function ForecastBody({
  data,
  withSpending,
  setWithSpending,
}: {
  data: Forecast;
  withSpending: boolean;
  setWithSpending: (v: boolean) => void;
}) {
  const points = useMemo(
    () => data.days.map((d) => ({ date: d.date, balanceCents: withSpending ? d.withSpendingCents : d.balanceCents })),
    [data, withSpending],
  );
  if (data.accountCount === 0)
    return (
      <EmptyState icon={TrendingUp} title="The forecast needs a checking, savings or cash account to start from." />
    );
  return (
    <>
      {(withSpending ? data.goesNegativeWithSpendingOn : data.goesNegativeOn) && (
        <div
          role="alert"
          data-testid="forecast-warning"
          className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            Your cash could drop below zero on{" "}
            <strong>
              {format(parseISO((withSpending ? data.goesNegativeWithSpendingOn : data.goesNegativeOn)!), "EEEE, MMM d")}
            </strong>
            {withSpending ? "" : ", even before everyday spending"}. Consider moving money in or delaying a bill.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Today" hint={`${data.accountCount} cash account${data.accountCount === 1 ? "" : "s"}`}>
          <Money cents={data.startCents} />
        </Tile>
        <Tile
          label="Lowest point"
          hint={format(parseISO((withSpending ? data.lowestWithSpending : data.lowest).date), "MMM d")}
        >
          <Money cents={(withSpending ? data.lowestWithSpending : data.lowest).balanceCents} />
        </Tile>
        <Tile
          label={`In ${data.horizonDays} days`}
          hint={format(parseISO(data.days[data.days.length - 1].date), "MMM d")}
        >
          <Money cents={withSpending ? data.endWithSpendingCents : data.endCents} />
        </Tile>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Projected cash balance</h2>
            <div className="flex items-center gap-2">
              <Switch id="fc-spend" checked={withSpending} onCheckedChange={setWithSpending} />
              <Label htmlFor="fc-spend" className="text-sm">
                Include everyday spending (<Money cents={data.typicalDailySpendCents} /> a day)
              </Label>
            </div>
          </div>
          <BalanceChart points={points} label="Projected cash" tickFormat="MMM d" height={240} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Expected bills and income</h2>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repeating bills or deposits were found in the next 30 days. They&apos;re detected from your history, so
              this fills in as it grows.
            </p>
          ) : (
            <ul className="divide-y divide-border/60" data-testid="forecast-events">
              {data.events.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {format(parseISO(e.date), "EEE, MMM d")}
                    </span>
                  </span>
                  <Money cents={e.amountCents} colorize sign="always" className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
          <p className="pt-2 text-xs text-muted-foreground">
            Only repeating items are included. Charges on credit cards are counted on the day they&apos;re expected, as
            if paid at once.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
