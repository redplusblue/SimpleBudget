"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTable } from "@/components/charts/chart-table";
import { formatCents } from "@/lib/finance/cents";
import type { WeekdayRow } from "@/lib/finance/spending-report-types";
import { EmptyNote, Section } from "./section";

const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** Average spend on each day of the week, over the days of that kind that have happened. */
export function WeekdayChart({ rows }: { rows: WeekdayRow[] }) {
  const max = Math.max(0, ...rows.map((r) => r.avgCents));
  const data = rows.map((r) => ({ ...r, name: NAMES[r.dow] }));
  return (
    <Section id="weekdays" title="Day of the week" description="Average spending on each weekday.">
      {max === 0 ? (
        <EmptyNote>No spending in this range.</EmptyNote>
      ) : (
        <ChartTable
          title="Average spending by weekday"
          columns={["Day", "Average", "Total", "Days counted"]}
          rows={rows.map((r) => [FULL[r.dow], { cents: r.avgCents }, { cents: r.cents }, String(r.occurrences)])}
        >
          <div
            className="h-48 w-full"
            data-testid="weekday-chart"
            role="img"
            aria-label={`Average spending by weekday: ${rows.map((r) => `${NAMES[r.dow]} ${formatCents(r.avgCents)}`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => formatCents(v, { compact: true })}
                  tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v, _n, item) => [
                    `${formatCents(Number(v))} average (${formatCents((item.payload as WeekdayRow).cents)} over ${(item.payload as WeekdayRow).occurrences} ${FULL[(item.payload as WeekdayRow).dow]})`,
                    "",
                  ]}
                  labelFormatter={(l) => String(l)}
                  separator=""
                />
                <Bar dataKey="avgCents" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {data.map((r) => (
                    <Cell
                      key={r.dow}
                      fill={
                        r.avgCents === max
                          ? "var(--brand-from)"
                          : "color-mix(in oklab, var(--brand-from) 45%, transparent)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartTable>
      )}
    </Section>
  );
}
