"use client";

import Link from "next/link";
import { useState } from "react";
import { Money } from "@/components/money";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CategoryComparison, ReportRange } from "@/lib/finance/spending-report-types";
import { cn } from "@/lib/utils";
import { spendingHref } from "./links";
import { EmptyNote, Section } from "./section";

type Mode = "previous" | "average";

/** Per-category change as diverging bars: green to the left (spending less), amber to the right (more). */
export function ComparisonCard({ range, rows }: { range: ReportRange; rows: CategoryComparison[] }) {
  const [mode, setMode] = useState<Mode>("previous");
  const canAverage = range.kind === "month";
  const active: Mode = canAverage ? mode : "previous";
  const deltaOf = (r: CategoryComparison) =>
    active === "previous" ? r.deltaPreviousCents : (r.deltaAverageCents ?? 0);
  const baselineOf = (r: CategoryComparison) => (active === "previous" ? r.previousCents : (r.averageCents ?? 0));

  const sorted = rows
    .filter((r) => deltaOf(r) !== 0 || r.cents !== 0)
    .sort((a, b) => Math.abs(deltaOf(b)) - Math.abs(deltaOf(a)) || b.cents - a.cents);
  const max = Math.max(1, ...sorted.map((r) => Math.abs(deltaOf(r))));
  const baselineLabel = active === "previous" ? range.previous.label : "the 3-month average";

  return (
    <Section
      id="comparison"
      title="What changed"
      description={`Spending by category compared with ${baselineLabel}`}
      actions={
        canAverage ? (
          <ToggleGroup
            type="single"
            variant="outline"
            value={active}
            onValueChange={(v) => v && setMode(v as Mode)}
            aria-label="Compare with"
          >
            <ToggleGroupItem value="previous" className="h-9 px-3 text-xs">
              vs last month
            </ToggleGroupItem>
            <ToggleGroupItem value="average" className="h-9 px-3 text-xs">
              vs 3-month avg
            </ToggleGroupItem>
          </ToggleGroup>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <EmptyNote>No spending to compare yet.</EmptyNote>
      ) : (
        <ul className="space-y-1" data-testid="comparison-list">
          {sorted.map((r) => {
            const delta = deltaOf(r);
            const pct = (Math.abs(delta) / max) * 100;
            const more = delta > 0;
            return (
              <li key={r.id ?? "none"}>
                <Link
                  href={spendingHref({ from: range.from, to: range.to }, { categoryId: r.id ?? "none" })}
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60 md:grid-cols-[10rem_minmax(0,1fr)_7rem]"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="truncate">{r.name}</span>
                  </span>
                  <span className="order-3 col-span-2 md:order-none md:col-span-1" aria-hidden>
                    <span className="relative flex h-3 items-center">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                      {delta !== 0 && (
                        <span
                          className={cn(
                            "absolute h-2.5 rounded-sm",
                            more ? "left-1/2 rounded-l-none bg-warning" : "right-1/2 rounded-r-none bg-positive",
                          )}
                          style={{ width: `${pct / 2}%` }}
                        />
                      )}
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    <Money
                      cents={Math.abs(delta)}
                      className={cn(
                        "font-medium",
                        delta === 0 ? "text-muted-foreground" : more ? "text-warning" : "text-positive",
                      )}
                    />
                    <span className="sr-only">
                      {delta === 0 ? " no change" : more ? " more" : " less"} than {baselineLabel}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      <Money cents={r.cents} /> vs <Money cents={baselineOf(r)} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
