import { format, parse } from "date-fns";
import Link from "next/link";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import type { MonthGlance } from "@/lib/finance/dashboard-types";
import { cn } from "@/lib/utils";
import { monthLink } from "./format";

function PaceLine({ glance }: { glance: MonthGlance }) {
  const pace = glance.pace;
  if (!pace) return null;
  if (pace.lastMonthToDateCents === 0) {
    return <p className="text-sm text-muted-foreground">No spending at this point last month to compare with.</p>;
  }
  const delta = pace.deltaCents;
  if (delta === 0) return <p className="text-sm text-muted-foreground">Exactly on pace with this point last month.</p>;
  return (
    <p className="text-sm" data-testid="pace">
      <Money cents={Math.abs(delta)} className={cn("font-semibold", delta < 0 ? "text-positive" : "text-warning")} />{" "}
      <span className="text-muted-foreground">{delta < 0 ? "less" : "more"} than this point last month</span>
    </p>
  );
}

export function MonthGlanceCard({ glance }: { glance: MonthGlance }) {
  const label = format(parse(glance.month, "yyyy-MM", new Date()), "MMMM");
  return (
    <Card className="h-full" aria-labelledby="glance-title">
      <CardContent className="space-y-5">
        <h2 id="glance-title" className="text-sm font-medium text-muted-foreground">
          {glance.isCurrent ? "This month" : label} at a glance
        </h2>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Spent{glance.isCurrent ? " so far" : ""}</p>
          <Link
            href={monthLink(glance.month, { type: "expense" })}
            className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Money cents={glance.spentCents} className="text-3xl font-semibold tracking-tight" />
          </Link>
          <PaceLine glance={glance} />
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4">
          <div>
            <dt className="text-sm text-muted-foreground">Income</dt>
            <dd>
              <Link
                href={monthLink(glance.month, { type: "income" })}
                className="rounded-md text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <Money cents={glance.incomeCents} />
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Net</dt>
            <dd className="text-lg font-semibold">
              <Money cents={glance.netCents} sign="always" colorize />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
