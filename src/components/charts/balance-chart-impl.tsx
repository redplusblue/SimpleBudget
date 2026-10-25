"use client";

import { format, parseISO } from "date-fns";
import { useEffect, useId, useRef, useState } from "react";
import { ChartTable } from "./chart-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/finance/cents";
import type { BalancePoint } from "@/lib/finance/accounts-overview";

/** Balance-over-time area chart with loading, empty and error states. */
export function BalanceChartImpl({
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
  return (
    <ChartTable
      title={`${label} by day`}
      columns={["Date", label]}
      rows={points.map((p) => [p.date, { cents: p.balanceCents, currency }])}
    >
      <AreaPlot
        points={points}
        currency={currency}
        height={height}
        label={label}
        tickFormat={tickFormat}
        gradientId={gradientId}
      />
    </ChartTable>
  );
}

const PAD = { left: 52, right: 6, top: 8, bottom: 22 };

/**
 * A small dependency-free SVG area chart. The dashboard's first screen draws this instead of loading a charting
 * library, which keeps the main thread free while the page becomes interactive.
 */
function AreaPlot({
  points,
  currency,
  height,
  label,
  tickFormat,
  gradientId,
}: {
  points: BalancePoint[];
  currency?: string;
  height: number;
  label: string;
  tickFormat: string;
  gradientId: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = points.map((p) => p.balanceCents);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 100) * 0.08;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const n = points.length;
  const x = (i: number) => PAD.left + (i / (n - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.balanceCents).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;
  const yTicks = [0, 1, 2, 3].map((k) => yMin + ((yMax - yMin) * k) / 3);
  const xCount = Math.max(2, Math.min(6, Math.floor(plotW / 84)));
  const xTicks = Array.from({ length: xCount }, (_, k) => Math.round((k * (n - 1)) / (xCount - 1)));
  const first = points[0];
  const last = points[n - 1];
  const h = hover === null ? null : points[hover];

  return (
    <div ref={box} style={{ height }} className="relative w-full" data-testid="balance-chart">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} from ${formatCents(first.balanceCents, { currency })} on ${format(parseISO(first.date), "MMM d")} to ${formatCents(last.balanceCents, { currency })} on ${format(parseISO(last.date), "MMM d")}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const rel = (e.clientX - r.left - PAD.left) / (plotW || 1);
            setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--brand-from)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brand-to)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <g data-sensitive>
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 8}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--text-faint)"
                  fontSize={11}
                >
                  {formatCents(t, { currency, compact: true })}
                </text>
              </g>
            ))}
          </g>
          {xTicks.map((i, k) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"}
              fill="var(--text-faint)"
              fontSize={11}
            >
              {format(parseISO(points[i].date), tickFormat)}
            </text>
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--brand-from)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {h && hover !== null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--text-faint)"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(hover)}
                cy={y(h.balanceCents)}
                r={4}
                fill="var(--brand-from)"
                stroke="var(--background)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div
          data-sensitive
          className="pointer-events-none absolute z-10 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs shadow-md"
          style={{ top: 0, left: Math.min(Math.max(x(hover) - 70, 0), Math.max(0, width - 150)) }}
        >
          <p className="text-muted-foreground">{format(parseISO(h.date), "EEE, MMM d, yyyy")}</p>
          <p className="font-medium">
            {label}: {formatCents(h.balanceCents, { currency })}
          </p>
        </div>
      )}
    </div>
  );
}
