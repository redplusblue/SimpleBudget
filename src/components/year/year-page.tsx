"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChartTable } from "@/components/charts/chart-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { monthSpan, spendingHref } from "@/components/spending/links";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { YearInReview, YearRanked } from "@/lib/finance/year-types";
import { cn } from "@/lib/utils";

const monthShort = (m: string) => format(parseISO(`${m}-01`), "MMM");
const monthLong = (m: string) => format(parseISO(`${m}-01`), "MMMM");
const pct = (n: number) => `${Math.round(n * 100)}%`;

function Tile({
  label,
  children,
  hint,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "good" | "bad";
}) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight",
            tone === "good" && "text-positive",
            tone === "bad" && "text-negative",
          )}
        >
          {children}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function RankedList({ rows, year, kind }: { rows: YearRanked[]; year: number; kind: "category" | "merchant" }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={`${r.id}-${r.name}`} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.name}</span>
            <span className="shrink-0">
              <Money cents={r.cents} /> <span className="text-xs text-muted-foreground">{pct(r.share)}</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className={cn("h-full rounded-full", kind === "category" ? "bg-brand" : "bg-brand-to")}
              style={{ width: `${(r.cents / max) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {r.count} purchase{r.count === 1 ? "" : "s"}
            {kind === "category" && (
              <>
                {" · "}
                <Link
                  className="text-link underline-offset-4 hover:underline"
                  href={spendingHref({ from: `${year}-01-01`, to: `${year}-12-31` }, { categoryId: r.id ?? "none" })}
                >
                  See them
                </Link>
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function YearPage() {
  const params = useSearchParams();
  const raw = params.get("year");
  const query = useQuery({
    queryKey: ["year", raw],
    queryFn: () => fetchJson<YearInReview>(`/api/year${raw ? `?year=${encodeURIComponent(raw)}` : ""}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const y = query.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{y ? `${y.year} in review` : "Year in review"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {y?.partial ? "The year so far." : "A look back at where the year went."}
          </p>
        </div>
        {y && y.availableYears.length > 1 && (
          <nav aria-label="Year" className="flex flex-wrap gap-1">
            {y.availableYears.map((yr) => (
              <Button key={yr} asChild variant={yr === y.year ? "default" : "outline"} size="sm" className="h-9">
                <Link href={`/year?year=${yr}`} aria-current={yr === y.year ? "page" : undefined}>
                  {yr}
                </Link>
              </Button>
            ))}
          </nav>
        )}
      </div>

      {query.isPending ? (
        <div className="space-y-4" aria-busy aria-label="Loading">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : query.isError || !y ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load that year.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : y.spentCents === 0 && y.incomeCents === 0 ? (
        <EmptyState icon={CalendarRange} title={`Nothing recorded in ${y.year}.`} />
      ) : (
        <div className="space-y-5" data-testid="year-review">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Spent"
              hint={
                y.previousSpentCents > 0
                  ? `${y.spentCents >= y.previousSpentCents ? "Up" : "Down"} ${pct(Math.abs(y.spentCents - y.previousSpentCents) / y.previousSpentCents)} on the year before`
                  : undefined
              }
            >
              <Money cents={y.spentCents} />
            </Tile>
            <Tile label="Income">
              <Money cents={y.incomeCents} />
            </Tile>
            <Tile
              label="Saved"
              tone={y.savingsRate !== null && y.savingsRate > 0 ? "good" : y.savingsRate !== null ? "bad" : undefined}
              hint={y.savingsRate !== null ? `${pct(y.savingsRate)} of income` : "No income recorded"}
            >
              <Money cents={y.incomeCents - y.spentCents} />
            </Tile>
            {y.netWorth && (
              <Tile
                label="Net worth"
                tone={y.netWorth.changeCents >= 0 ? "good" : "bad"}
                hint={
                  <>
                    From <Money cents={y.netWorth.startCents} /> to <Money cents={y.netWorth.endCents} />
                  </>
                }
              >
                <Money cents={y.netWorth.changeCents} sign="always" />
              </Tile>
            )}
          </div>

          <Card>
            <CardContent className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Month by month</h2>
              <ChartTable
                title="Spending and income by month"
                columns={["Month", "Spent", "Income"]}
                rows={y.months.map((m) => [monthLong(m.month), { cents: m.spentCents }, { cents: m.incomeCents }])}
              >
                <MonthBars months={y.months} />
              </ChartTable>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground">Where it went</h2>
                <RankedList rows={y.topCategories} year={y.year} kind="category" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground">Where you shopped most</h2>
                <RankedList rows={y.topMerchants} year={y.year} kind="merchant" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Highlights</h2>
              <ul className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2" data-testid="year-highlights">
                {y.priciestMonth && (
                  <li>
                    Priciest month: <strong>{monthLong(y.priciestMonth.month)}</strong> (
                    <Money cents={y.priciestMonth.spentCents} />)
                  </li>
                )}
                {y.cheapestMonth && (
                  <li>
                    Lightest month: <strong>{monthLong(y.cheapestMonth.month)}</strong> (
                    <Money cents={y.cheapestMonth.spentCents} />)
                  </li>
                )}
                {y.biggestPurchase && (
                  <li>
                    Biggest purchase: <strong>{y.biggestPurchase.name}</strong> on{" "}
                    {format(parseISO(y.biggestPurchase.date), "MMM d")} (<Money cents={y.biggestPurchase.amountCents} />
                    )
                  </li>
                )}
                {y.busiestDay && (
                  <li>
                    Busiest day: <strong>{format(parseISO(y.busiestDay.date), "MMM d")}</strong> (
                    <Money cents={y.busiestDay.cents} />)
                  </li>
                )}
                <li>
                  <strong>{y.noSpendDays}</strong> of {y.daysCounted} days with no spending
                </li>
                <li>
                  <strong>{y.purchaseCount.toLocaleString()}</strong> purchases, about{" "}
                  <Money cents={y.avgPerDayCents} /> a day
                </li>
                {y.recurringCount > 0 && (
                  <li>
                    <strong>{y.recurringCount}</strong> subscriptions and regular bills now cost{" "}
                    <Money cents={y.recurringYearlyCents} /> a year
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          {(y.risers.length > 0 || y.fallers.length > 0) && (
            <div className="grid gap-5 lg:grid-cols-2">
              {[
                { title: "Spent more on", rows: y.risers },
                { title: "Spent less on", rows: y.fallers },
              ].map(({ title, rows }) => (
                <Card key={title}>
                  <CardContent className="space-y-2">
                    <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
                    {rows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nothing notable.</p>
                    ) : (
                      <ul className="divide-y divide-border/60 text-sm">
                        {rows.map((r) => (
                          <li key={r.name} className="flex items-center justify-between gap-3 py-2">
                            <span className="min-w-0 truncate font-medium">{r.name}</span>
                            <span className="shrink-0">
                              <Money
                                cents={r.deltaCents}
                                sign="always"
                                className={r.deltaCents > 0 ? "text-negative" : "text-positive"}
                              />
                              <span className="ml-2 text-xs text-muted-foreground">
                                <Money cents={r.cents} /> vs <Money cents={r.previousCents} />
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MonthBars({ months }: { months: YearInReview["months"] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.spentCents, m.incomeCents)));
  return (
    <ul className="space-y-1.5" data-testid="month-bars">
      {months.map((m) => (
        <li key={m.month} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 text-sm">
          <Link href={spendingHref(monthSpan(m.month))} className="text-muted-foreground hover:text-foreground">
            {monthShort(m.month)}
          </Link>
          <div className="space-y-0.5" aria-hidden>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(m.spentCents / max) * 100}%` }} />
            </div>
            {m.incomeCents > 0 && (
              <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-positive" style={{ width: `${(m.incomeCents / max) * 100}%` }} />
              </div>
            )}
          </div>
          <Money cents={m.spentCents} className="w-24 text-right" />
        </li>
      ))}
      <li className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-full bg-brand" /> Spent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1 w-4 rounded-full bg-positive" /> Income
        </span>
      </li>
    </ul>
  );
}
