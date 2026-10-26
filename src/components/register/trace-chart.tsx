"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/finance/cents";
import type { TraceReport } from "@/lib/finance/trace-types";

/** Spending with this merchant over the last 24 months, oldest on the left. */
export default function TraceChart({ months }: { months: TraceReport["byMonth"] }) {
  const data = [...months].reverse().map((m) => ({ ...m, label: m.month.slice(2) }));
  return (
    <div
      className="h-40 w-full"
      data-testid="trace-chart"
      role="img"
      aria-label={`Spending by month for the last 24 months, ${formatCents(data.reduce((s, m) => s + m.spentCents, 0))} in total`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            interval={5}
            tick={{ fill: "var(--text-faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatCents(v, { compact: true })}
            tick={{ fill: "var(--text-faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
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
              `${formatCents(Number(v))} (${(item.payload as { count: number }).count} charge${(item.payload as { count: number }).count === 1 ? "" : "s"})`,
              "",
            ]}
            labelFormatter={(l) => String(l)}
            separator=""
          />
          <Bar dataKey="spentCents" fill="var(--brand-from)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
