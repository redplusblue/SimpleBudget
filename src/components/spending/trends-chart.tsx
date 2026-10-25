"use client";

import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/finance/cents";
import type { TrendReport } from "@/lib/finance/spending-report-types";
import { monthSpan, spendingHref } from "./links";
import { EmptyNote, Section } from "./section";

const monthShort = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return format(new Date(y, mo - 1, 1), "MMM");
};
const monthLong = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return format(new Date(y, mo - 1, 1), "MMMM yyyy");
};

/** 12 months of spending stacked by category, with income as a line. Clicking a bar opens that month and category. */
export function TrendsChart({ trends }: { trends: TrendReport }) {
  const router = useRouter();
  const hasData = trends.series.some((s) => s.values.some((v) => v > 0));
  const data = trends.months.map((month, i) => ({
    month,
    label: monthShort(month),
    income: trends.incomeCents[i],
    ...Object.fromEntries(trends.series.map((s, j) => [`s${j}`, s.values[i]])),
  }));

  return (
    <Section
      id="trends"
      title="12-month trend"
      description="Spending by category each month, with income as a line. Click a bar to see its purchases."
    >
      {!hasData ? (
        <EmptyNote>Trends appear as months of spending build up.</EmptyNote>
      ) : (
        <div
          className="h-72 w-full"
          data-testid="trends-chart"
          role="img"
          aria-label={`Monthly spending and income for the last ${trends.months.length} months`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tickFormatter={(v: number) => formatCents(v, { compact: true })}
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)", opacity: 0.5 }}
                contentStyle={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelFormatter={(_l, items) => (items?.[0]?.payload?.month ? monthLong(items[0].payload.month) : "")}
                formatter={(v, key) => [
                  formatCents(Number(v)),
                  key === "income" ? "Income" : (trends.series[Number(String(key).slice(1))]?.name ?? String(key)),
                ]}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
                formatter={(key) =>
                  key === "income" ? "Income" : (trends.series[Number(String(key).slice(1))]?.name ?? String(key))
                }
              />
              {trends.series.map((s, j) => (
                <Bar
                  key={j}
                  dataKey={`s${j}`}
                  stackId="spending"
                  fill={s.color}
                  isAnimationActive={false}
                  cursor="pointer"
                  radius={j === trends.series.length - 1 ? [4, 4, 0, 0] : 0}
                  onClick={(d: { payload?: { month?: string } }) => {
                    const month = d?.payload?.month;
                    if (month)
                      router.push(spendingHref(monthSpan(month), s.other ? {} : { categoryId: s.id ?? "none" }));
                  }}
                />
              ))}
              <Line
                type="monotone"
                dataKey="income"
                stroke="var(--positive)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  );
}
