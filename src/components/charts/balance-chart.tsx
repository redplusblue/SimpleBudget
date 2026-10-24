"use client";

import { format, parseISO } from "date-fns";
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/finance/cents";
import type { BalancePoint } from "@/lib/finance/accounts-overview";

/** Balance-over-time area chart with loading, empty and error states. */
export function BalanceChart({
  points,
  currency,
  loading,
  error,
  height = 200,
  label = "Balance",
  tickFormat = "MMM d",
}: {
  points: BalancePoint[] | undefined;
  currency?: string;
  loading?: boolean;
  error?: boolean;
  height?: number;
  /** Name shown in the tooltip, e.g. "Net worth". */
  label?: string;
  /** date-fns format for x-axis ticks. */
  tickFormat?: string;
}) {
  const gradientId = useId();
  if (loading) return <Skeleton style={{ height }} className="w-full rounded-xl" />;
  if (error) {
    return (
      <div
        role="alert"
        style={{ height }}
        className="grid place-items-center rounded-xl border border-dashed border-border text-sm text-negative"
      >
        Couldn&apos;t load the balance history.
      </div>
    );
  }
  if (!points || points.length < 2) {
    return (
      <div
        style={{ height }}
        className="grid place-items-center rounded-xl border border-dashed border-border px-4 text-center text-sm text-muted-foreground"
      >
        Balance history builds up after each sync. Check back tomorrow.
      </div>
    );
  }
  const data = points.map((p) => ({ date: p.date, value: p.balanceCents }));
  const fmt = (v: number) => formatCents(v, { currency, compact: true });
  return (
    <div style={{ height }} className="w-full" data-testid="balance-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-from)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brand-to)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => format(parseISO(d), tickFormat)}
            tick={{ fill: "var(--text-faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={fmt}
            tick={{ fill: "var(--text-faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: "var(--text-faint)", strokeDasharray: "3 3" }}
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--text-muted)" }}
            labelFormatter={(d) => format(parseISO(String(d)), "EEE, MMM d, yyyy")}
            formatter={(v) => [formatCents(Number(v), { currency }), label]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--brand-from)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
