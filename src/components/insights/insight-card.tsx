import { AlertTriangle, ArrowUpRight, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/money";
import type { Insight, InsightSeverity } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

const STYLE: Record<InsightSeverity, { icon: typeof Info; label: string; badge: string }> = {
  warn: { icon: AlertTriangle, label: "Needs attention", badge: "bg-warning/15 text-warning" },
  good: { icon: CheckCircle2, label: "Good news", badge: "bg-positive/15 text-positive" },
  info: { icon: Info, label: "Worth knowing", badge: "bg-surface-2 text-muted-foreground" },
};

/** One insight. The severity is stated in text for screen readers; color and icon are secondary. */
export function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  const { icon: Icon, label, badge } = STYLE[insight.severity];
  return (
    <article
      data-testid="insight"
      data-severity={insight.severity}
      className={cn("flex gap-3", compact ? "py-2.5" : "rounded-2xl border border-border bg-card p-4")}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", badge)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="sr-only">{label}</p>
        <h3 data-sensitive className="text-sm leading-snug font-medium">
          {insight.title}
        </h3>
        {!compact && (
          <p data-sensitive className="text-sm text-muted-foreground">
            {insight.body}
          </p>
        )}
        {insight.link && !compact && (
          <Link
            href={insight.link}
            className="inline-flex min-h-8 items-center gap-1 text-sm text-link underline-offset-4 hover:underline"
          >
            View transactions <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {insight.valueCents !== undefined && !compact && (
        <Money cents={insight.valueCents} className="shrink-0 text-sm font-semibold" />
      )}
    </article>
  );
}
