"use client";

import { Table2, BarChart3 } from "lucide-react";
import { useId, useState } from "react";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";

export type TableCell = string | { cents: number; currency?: string };

/**
 * Wraps a chart with a "View as table" switch, so the numbers are available to screen readers, keyboards and anyone
 * who prefers exact values. The chart stays the default.
 */
export function ChartTable({
  title,
  columns,
  rows,
  children,
  className,
}: {
  /** Names the table for assistive technology, e.g. "Net worth by day". */
  title: string;
  columns: string[];
  rows: TableCell[][];
  children: React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      {asTable ? (
        <div
          id={id}
          tabIndex={0}
          role="region"
          aria-label={`${title} (table)`}
          className="max-h-72 overflow-auto rounded-xl border border-border"
          data-testid="chart-table"
        >
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-2 text-muted-foreground">
              <tr>
                {columns.map((c, i) => (
                  <th key={c} scope="col" className={`p-2 font-medium ${i > 0 ? "text-right" : ""}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  {r.map((cell, j) =>
                    j === 0 ? (
                      <th key={j} scope="row" className="p-2 font-normal whitespace-nowrap">
                        {typeof cell === "string" ? cell : ""}
                      </th>
                    ) : (
                      <td key={j} className="p-2 text-right tabular-nums">
                        {typeof cell === "string" ? cell : <Money cents={cell.cents} currency={cell.currency} />}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      <div className="mt-1 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground"
          aria-pressed={asTable}
          aria-controls={asTable ? id : undefined}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
          {asTable ? "View as chart" : "View as table"}
        </Button>
      </div>
    </div>
  );
}
