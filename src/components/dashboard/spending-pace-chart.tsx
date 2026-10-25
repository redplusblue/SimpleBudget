"use client";

import { format, parse } from "date-fns";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTable } from "@/components/charts/chart-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatCents } from "@/lib/finance/cents";
import type { SpendingChart } from "@/lib/finance/dashboard-types";

const LEGEND = [
  { key: "current", label: "This month", className: "bg-brand" },
  { key: "last", label: "Last month", className: "border-t-2 border-dashed border-muted-foreground" },
  { key: "average", label: "3-month average", className: "h-px bg-text-faint opacity-70" },
] as const;

/** The signature chart: cumulative spend this month against last month (dashed) and the 3-month average (faint). */
export function SpendingPaceChart({ chart }: { chart: SpendingChart }) {
  const hasSpend = chart.points.some((p) => (p.current ?? 0) > 0);
  const monthName = (m: string) => format(parse(m, "yyyy-MM", new Date()), "MMMM");
  const currentTotal = [...chart.points].reverse().find((p) => p.current !== null)?.current ?? 0;

  return (
    <Card className="h-full" aria-labelledby="pace-title">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pace-title" className="text-sm font-medium text-muted-foreground">
            Spending pace
          </h2>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {LEGEND.map((l) => (
              <li key={l.key} className="flex items-center gap-1.5">
                <span aria-hidden className={`inline-block w-4 ${l.className} ${l.key === "current" ? "h-0.5" : ""}`} />
                {l.key === "last" ? monthName(chart.lastMonth) : l.label}
              </li>
            ))}
          </ul>
        </div>
        {!hasSpend && !chart.hasComparison ? (
          <div className="grid min-h-64 flex-1 place-items-center rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            No spending in {monthName(chart.month)} yet. Your pace will appear as purchases come in.
          </div>
        ) : (
          <ChartTable
            className="flex flex-1 flex-col"
            title="Cumulative spending by day"
            columns={["Day", "This month", monthName(chart.lastMonth), "3-month average"]}
            rows={chart.points.map((p) => [
              `Day ${p.day}`,
              { cents: p.current ?? 0 },
              { cents: p.last ?? 0 },
              { cents: p.average ?? 0 },
            ])}
          >
            <div
              className="h-64 w-full"
              data-testid="spending-chart"
              role="img"
              aria-label={`Cumulative spending in ${monthName(chart.month)}: ${formatCents(currentTotal)} so far, compared with last month and the three month average.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatCents(v, { compact: true })}
                    tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--text-faint)", strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    labelFormatter={(d) => `Day ${d}`}
                    formatter={(v, name) => [
                      formatCents(Number(v)),
                      name === "current"
                        ? "This month"
                        : name === "last"
                          ? monthName(chart.lastMonth)
                          : "3-month average",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="average"
                    stroke="var(--text-faint)"
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="last"
                    stroke="var(--text-muted)"
                    strokeWidth={1.75}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="var(--brand-from)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartTable>
        )}
      </CardContent>
    </Card>
  );
}
