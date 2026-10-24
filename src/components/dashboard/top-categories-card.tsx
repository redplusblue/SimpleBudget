"use client";

import { ArrowDownRight, ArrowUpRight, PieChart as PieIcon } from "lucide-react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { formatCents } from "@/lib/finance/cents";
import type { CategoryBreakdown } from "@/lib/finance/dashboard-types";
import { cn } from "@/lib/utils";
import { monthLink, percent } from "./format";

const OTHER_COLOR = "#6B7385";

export function TopCategoriesCard({ breakdown, month }: { breakdown: CategoryBreakdown; month: string }) {
  const slices = [
    ...breakdown.items.map((i) => ({ key: String(i.id ?? "none"), name: i.name, value: i.cents, color: i.color })),
    ...(breakdown.otherCents > 0
      ? [{ key: "other", name: "Everything else", value: breakdown.otherCents, color: OTHER_COLOR }]
      : []),
  ];

  return (
    <Card className="h-full" aria-labelledby="categories-title">
      <CardContent className="space-y-4">
        <h2 id="categories-title" className="text-sm font-medium text-muted-foreground">
          Top categories
        </h2>
        {breakdown.totalCents === 0 ? (
          <div className="grid h-56 place-items-center gap-2 rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            <PieIcon className="size-6" aria-hidden />
            No spending this month yet.
          </div>
        ) : (
          <>
            <div
              className="relative mx-auto h-44 w-44"
              data-testid="category-donut"
              role="img"
              aria-label={`Spending by category: ${slices.map((s) => `${s.name} ${formatCents(s.value)}`).join(", ")}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="68%"
                    outerRadius="100%"
                    paddingAngle={slices.length > 1 ? 2 : 0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {slices.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    itemStyle={{ color: "var(--text)" }}
                    formatter={(v) => formatCents(Number(v))}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                <Money cents={breakdown.totalCents} compact className="text-xl font-semibold tracking-tight" />
                <span className="text-xs text-muted-foreground">spent</span>
              </div>
            </div>
            <ul className="space-y-1">
              {breakdown.items.map((i) => {
                const up = i.deltaCents > 0;
                return (
                  <li key={i.id ?? "none"}>
                    <Link
                      href={monthLink(month, { type: "expense", category: String(i.id ?? "none") })}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: i.color }} />
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{percent(i.share, 0)}</span>
                      <span className="w-20 shrink-0 text-right">
                        <Money cents={i.cents} className="font-medium" />
                      </span>
                      <span
                        className={cn(
                          "hidden w-16 shrink-0 items-center justify-end gap-0.5 text-xs sm:flex",
                          i.deltaCents === 0 ? "text-muted-foreground" : up ? "text-warning" : "text-positive",
                        )}
                        title="Change vs last month"
                      >
                        {i.deltaCents !== 0 &&
                          (up ? (
                            <ArrowUpRight className="size-3" aria-hidden />
                          ) : (
                            <ArrowDownRight className="size-3" aria-hidden />
                          ))}
                        <Money cents={Math.abs(i.deltaCents)} compact />
                        <span className="sr-only">
                          {i.deltaCents === 0 ? "no change" : up ? "more" : "less"} than last month
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              {breakdown.otherCents > 0 && (
                <li className="flex min-h-11 items-center gap-3 px-2 py-1.5 text-sm text-muted-foreground">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: OTHER_COLOR }} />
                  <span className="flex-1">Everything else</span>
                  <Money cents={breakdown.otherCents} />
                </li>
              )}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
