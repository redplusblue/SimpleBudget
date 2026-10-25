import Link from "next/link";
import { CategoryBadge } from "@/components/category-icon";
import { Money } from "@/components/money";
import { Card, CardContent } from "@/components/ui/card";
import { monthSpan, spendingHref } from "@/components/spending/links";
import type { TargetProgress } from "@/lib/finance/targets-types";
import { cn } from "@/lib/utils";
import { TargetBar } from "./progress-bar";

const STATUS_TEXT = { ok: "", warning: "Close to the limit", over: "Over the target" } as const;

function Row({ t, month }: { t: TargetProgress; month: string }) {
  const href = spendingHref(
    monthSpan(month),
    t.kind === "category" ? { categoryId: t.subjectId } : { tagId: t.subjectId },
  );
  const projectedFraction = t.projectedCents !== null ? t.projectedCents / t.amountCents : null;
  const pct = Math.round(t.fraction * 100);
  return (
    <li data-testid="target-row">
      <Link
        href={href}
        className="block space-y-2 rounded-xl px-2 py-2.5 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <div className="flex items-center gap-3">
          {t.kind === "category" ? (
            <CategoryBadge icon={t.icon} color={t.color} className="size-8" />
          ) : (
            <span aria-hidden className="ml-2.5 size-3 shrink-0 rounded-full" style={{ background: t.color }} />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2 text-sm font-medium">
              <span className="truncate">{t.name}</span>
              {t.kind === "tag" && <span className="shrink-0 text-xs font-normal text-muted-foreground">tag</span>}
              {t.scope === "month" && (
                <span className="shrink-0 text-xs font-normal text-muted-foreground">this month only</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              <Money cents={t.spentCents} className="font-medium text-foreground" /> of <Money cents={t.amountCents} />
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 text-sm font-semibold tabular-nums",
              t.status === "over" ? "text-negative" : t.status === "warning" ? "text-warning" : "text-foreground",
            )}
          >
            {pct}%
          </span>
        </div>
        <TargetBar
          fraction={t.fraction}
          status={t.status}
          label={`${t.name}: ${pct}% of the target used`}
          projectedFraction={t.onPaceToExceed ? projectedFraction : null}
        />
        <p
          className={cn(
            "text-xs",
            t.status === "over"
              ? "text-negative"
              : t.onPaceToExceed || t.status === "warning"
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {t.remainingCents >= 0 ? (
            <>
              <Money cents={t.remainingCents} /> left
            </>
          ) : (
            <>
              Over by <Money cents={-t.remainingCents} />
            </>
          )}
          {STATUS_TEXT[t.status] && ` · ${STATUS_TEXT[t.status]}`}
          {t.projectedCents !== null && t.status !== "over" && (
            <>
              {" · "}
              {t.onPaceToExceed ? "on pace to reach " : "on pace for "}
              <Money cents={t.projectedCents} /> by month end
            </>
          )}
        </p>
      </Link>
    </li>
  );
}

/** Progress toward each spending target for a month. Renders nothing at all when there are no targets. */
export function TargetsCard({
  targets,
  month,
  className,
}: {
  targets: TargetProgress[];
  month: string;
  className?: string;
}) {
  if (targets.length === 0) return null;
  return (
    <Card id="targets" aria-labelledby="targets-title" className={className}>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="targets-title" className="text-sm font-medium text-muted-foreground">
            Targets
          </h2>
          <Link href="/settings/targets" className="text-sm text-primary underline-offset-4 hover:underline">
            Manage
          </Link>
        </div>
        <ul className="-mx-2 space-y-0.5" data-testid="targets-list">
          {targets.map((t) => (
            <Row key={t.id} t={t} month={month} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
