"use client";

import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { Cadence, RecurringItem, RecurringReport } from "@/lib/finance/recurring-types";
import { transactionsHref } from "./links";
import { EmptyNote, Section } from "./section";

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};

function Row({ item }: { item: RecurringItem }) {
  return (
    <li>
      <Link
        href={transactionsHref({ merchant: item.key, merchantName: item.name, type: "expense" })}
        className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{item.name}</span>
            {item.increasePct !== null && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                title={item.previousAmountCents ? `Was ${(item.previousAmountCents / 100).toFixed(2)}` : undefined}
              >
                <ArrowUpRight className="size-3" aria-hidden /> +{(item.increasePct * 100).toFixed(0)}%
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {CADENCE_LABEL[item.cadence]} · {item.count} charges ·{" "}
            {item.active
              ? `next ${format(parseISO(item.nextDate), "MMM d")}`
              : `last ${format(parseISO(item.lastDate), "MMM d, yyyy")}`}
            {item.overdueDays > 0 && item.active
              ? ` (${item.overdueDays} day${item.overdueDays === 1 ? "" : "s"} late)`
              : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money cents={item.amountCents} className="text-sm font-medium" />
          {item.cadence !== "monthly" && (
            <p className="text-xs text-muted-foreground">
              <Money cents={item.monthlyCostCents} />
              /mo
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

/** Subscriptions and regular bills found in your history, with what they cost per month. */
export function RecurringCard() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => fetchJson<RecurringReport>("/api/recurring"),
    staleTime: 60_000,
  });

  return (
    <Section
      id="recurring"
      title="Subscriptions & recurring"
      description="Charges that repeat weekly, monthly or yearly at a similar amount (3 or more in a row)."
    >
      {isPending ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm">
          <span className="text-negative">Couldn&apos;t load recurring charges.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : data.items.length === 0 && data.inactive.length === 0 ? (
        <EmptyNote>No recurring charges detected yet. They show up after three similar charges in a row.</EmptyNote>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface-2/60 px-3 py-2.5">
            <span className="text-sm text-muted-foreground">Total per month</span>
            <span data-testid="recurring-total" className="text-lg font-semibold">
              <Money cents={data.monthlyTotalCents} />
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (<Money cents={data.yearlyTotalCents} compact /> a year)
              </span>
            </span>
          </div>
          <ul className="-mx-2 divide-y divide-border/60" data-testid="recurring-list">
            {data.items.map((i) => (
              <Row key={i.key} item={i} />
            ))}
          </ul>
          {data.inactive.length > 0 && (
            <details className="rounded-xl border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Stopped or cancelled ({data.inactive.length})
              </summary>
              <ul className="-mx-2 mt-2 divide-y divide-border/60 opacity-80">
                {data.inactive.map((i) => (
                  <Row key={i.key} item={i} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Section>
  );
}
