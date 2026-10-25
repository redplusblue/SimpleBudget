"use client";

import { LayoutGrid, PieChart as PieIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { Sparkline } from "@/components/charts/sparkline";
import { Money } from "@/components/money";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCents } from "@/lib/finance/cents";
import type { CategoryBreakdownRow, ReportRange } from "@/lib/finance/spending-report-types";
import { spendingHref } from "./links";
import { EmptyNote, Section } from "./section";

type View = "donut" | "treemap";

interface NodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fill?: string;
  share?: number;
  href?: string;
}

export function CategoryBreakdown({
  range,
  rows,
  totalCents,
}: {
  range: ReportRange;
  rows: CategoryBreakdownRow[];
  totalCents: number;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("donut");
  const span = { from: range.from, to: range.to };
  const hrefFor = (r: CategoryBreakdownRow) => spendingHref(span, { categoryId: r.id ?? "none" });
  const data = rows.map((r) => ({
    name: r.name,
    value: r.cents,
    size: r.cents,
    fill: r.color,
    share: r.share,
    href: hrefFor(r),
  }));

  return (
    <Section
      id="categories"
      title="By category"
      actions={
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          aria-label="Chart type"
        >
          <ToggleGroupItem value="donut" aria-label="Donut chart" className="h-9 px-3">
            <PieIcon className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="treemap" aria-label="Treemap" className="h-9 px-3">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {rows.length === 0 ? (
        <EmptyNote>No spending in this range.</EmptyNote>
      ) : (
        <>
          <div
            className="mx-auto h-64 w-full max-w-md"
            data-testid={view === "donut" ? "category-donut" : "category-treemap"}
            role="img"
            aria-label={`Spending by category: ${rows.map((r) => `${r.name} ${formatCents(r.cents)}`).join(", ")}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              {view === "donut" ? (
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={data.length > 1 ? 2 : 0}
                    stroke="none"
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(d) => d?.payload?.href && router.push(d.payload.href)}
                  >
                    {data.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
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
              ) : (
                <Treemap
                  data={data}
                  dataKey="size"
                  isAnimationActive={false}
                  content={<TreemapCell onOpen={(href) => router.push(href)} />}
                />
              )}
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="category-table">
              <caption className="sr-only">Spending by category with a six month trend</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 text-left font-normal">
                    Category
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    Share
                  </th>
                  <th scope="col" className="py-1 text-right font-normal">
                    Spent
                  </th>
                  <th scope="col" className="hidden py-1 text-right font-normal sm:table-cell">
                    Purchases
                  </th>
                  <th scope="col" className="py-1 pl-4 text-right font-normal">
                    6 months
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id ?? "none"} className="border-t border-border/60">
                    <td className="py-1">
                      <Link
                        href={hrefFor(r)}
                        className="flex min-h-11 items-center gap-2 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                        <span className="truncate">{r.name}</span>
                      </Link>
                    </td>
                    <td className="py-1 text-right text-muted-foreground tabular-nums">
                      {(r.share * 100).toFixed(r.share < 0.1 ? 1 : 0)}%
                    </td>
                    <td className="py-1 text-right font-medium">
                      <Money cents={r.cents} />
                    </td>
                    <td className="hidden py-1 text-right text-muted-foreground tabular-nums sm:table-cell">
                      {r.count}
                    </td>
                    <td className="py-1 pl-4">
                      <span className="flex justify-end" style={{ color: r.color }}>
                        <Sparkline
                          values={r.trend}
                          width={72}
                          height={24}
                          label={`${r.name} over the last six months`}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <th scope="row" className="py-2 text-left font-medium">
                    Total
                  </th>
                  <td />
                  <td className="py-2 text-right font-semibold">
                    <Money cents={totalCents} />
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

/** One rectangle of the treemap: a link-like region labeled with the category and its share. */
function TreemapCell({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  name,
  fill,
  share = 0,
  href,
  onOpen,
}: NodeProps & { onOpen: (href: string) => void }) {
  if (width < 2 || height < 2) return <g />;
  const roomForLabel = width > 64 && height > 38;
  return (
    <g
      role="link"
      tabIndex={href ? 0 : -1}
      aria-label={name ? `${name}, ${(share * 100).toFixed(0)} percent` : undefined}
      style={{ cursor: href ? "pointer" : "default", outline: "none" }}
      onClick={() => href && onOpen(href)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && href && onOpen(href)}
    >
      <rect x={x} y={y} width={width} height={height} rx={6} fill={fill} stroke="var(--card)" strokeWidth={2} />
      {roomForLabel && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={12} fontWeight={600} style={{ pointerEvents: "none" }}>
            {name && name.length * 7 > width - 12
              ? `${name.slice(0, Math.max(1, Math.floor((width - 12) / 7) - 1))}…`
              : name}
          </text>
          <text x={x + 8} y={y + 33} fill="#fff" fillOpacity={0.85} fontSize={11} style={{ pointerEvents: "none" }}>
            {(share * 100).toFixed(share < 0.1 ? 1 : 0)}%
          </text>
        </>
      )}
    </g>
  );
}
