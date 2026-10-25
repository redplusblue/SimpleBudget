import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import type { ReportRange, ReportSummary } from "@/lib/finance/spending-report-types";
import { cn } from "@/lib/utils";
import { incomeHref, spendingHref, transactionsHref } from "./links";

function Delta({ cents, label, goodWhenUp }: { cents: number; label: string; goodWhenUp: boolean }) {
  if (cents === 0) return <p className="text-xs text-muted-foreground">Same as {label}</p>;
  const up = cents > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("flex items-center gap-1 text-xs", good ? "text-positive" : "text-warning")}>
      <Icon className="size-3" aria-hidden />
      <Money cents={Math.abs(cents)} /> {up ? "more" : "less"} than {label}
    </p>
  );
}

function Tile({
  label,
  href,
  children,
  testId,
}: {
  label: string;
  href?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const body = (
    <CardContent className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </CardContent>
  );
  return (
    <Card data-testid={testId} className={cn("py-4", href && "transition-colors hover:bg-surface-2")}>
      {href ? (
        <Link href={href} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

/** The headline numbers. Anything that is a list of transactions links to the register. */
export function SummaryCards({ range, summary }: { range: ReportRange; summary: ReportSummary }) {
  const span = { from: range.from, to: range.to };
  const prevLabel = range.kind === "month" ? range.previous.label.split(" ")[0] : "the previous period";
  const { largest } = summary;
  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <Tile label="Spent" href={spendingHref(span)} testId="tile-spent">
        <Money cents={summary.spentCents} className="block text-xl font-semibold tracking-tight" />
        <Delta cents={summary.spentCents - summary.previousSpentCents} label={prevLabel} goodWhenUp={false} />
      </Tile>
      <Tile label="Income" href={incomeHref(span)} testId="tile-income">
        <Money cents={summary.incomeCents} className="block text-xl font-semibold tracking-tight" />
        <Delta cents={summary.incomeCents - summary.previousIncomeCents} label={prevLabel} goodWhenUp />
      </Tile>
      <Tile label="Net" testId="tile-net">
        <Money cents={summary.netCents} sign="always" colorize className="block text-xl font-semibold tracking-tight" />
        <p className="text-xs text-muted-foreground">Income minus spending</p>
      </Tile>
      <Tile label="Savings rate" testId="tile-savings">
        <p
          className={cn(
            "text-xl font-semibold tracking-tight tabular-nums",
            summary.savingsRate !== null && summary.savingsRate < 0 && "text-warning",
          )}
        >
          {summary.savingsRate === null ? "—" : `${(summary.savingsRate * 100).toFixed(0)}%`}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary.savingsRate === null ? "No income in this range" : "Of income not spent"}
        </p>
      </Tile>
      <Tile label="Purchases" href={spendingHref(span)} testId="tile-count">
        <p className="text-xl font-semibold tracking-tight tabular-nums">{summary.purchaseCount.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">Transfers and excluded items skipped</p>
      </Tile>
      <Tile label="Average per day" testId="tile-avg">
        <Money cents={summary.avgPerDayCents} className="block text-xl font-semibold tracking-tight" />
        <p className="text-xs text-muted-foreground">
          Over {range.elapsedDays} day{range.elapsedDays === 1 ? "" : "s"}
        </p>
      </Tile>
      <Tile
        label="Largest purchase"
        href={
          largest
            ? transactionsHref({
                from: largest.date,
                to: largest.date,
                type: "expense",
                minAmountCents: largest.amountCents,
              })
            : undefined
        }
        testId="tile-largest"
      >
        {largest ? (
          <>
            <Money cents={largest.amountCents} className="block text-xl font-semibold tracking-tight" />
            <p className="truncate text-xs text-muted-foreground" title={largest.name}>
              {largest.name} · {format(parseISO(largest.date), "MMM d")}
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-semibold tracking-tight">—</p>
            <p className="text-xs text-muted-foreground">No purchases</p>
          </>
        )}
      </Tile>
    </section>
  );
}
