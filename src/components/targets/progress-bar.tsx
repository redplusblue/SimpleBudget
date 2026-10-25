import type { TargetStatus } from "@/lib/finance/targets-types";
import { cn } from "@/lib/utils";

const FILL: Record<TargetStatus, string> = {
  ok: "bg-brand-gradient",
  warning: "bg-warning",
  over: "bg-negative",
};

/** A progress bar that goes accent -> amber (80%) -> red (over 100%). The status is also spelled out in text nearby. */
export function TargetBar({
  fraction,
  status,
  label,
  projectedFraction,
}: {
  fraction: number;
  status: TargetStatus;
  label: string;
  projectedFraction?: number | null;
}) {
  const pct = Math.min(Math.max(fraction, 0), 1) * 100;
  const mark = projectedFraction != null && projectedFraction > 0 ? Math.min(projectedFraction, 1) * 100 : null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(fraction, 9.99) * 100)}
      className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", FILL[status])}
        style={{ width: `${pct}%` }}
      />
      {mark !== null && mark > pct && (
        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-foreground/40"
          style={{ left: `calc(${mark}% - 1px)` }}
          title="Where you're on pace to finish the month"
        />
      )}
    </div>
  );
}
