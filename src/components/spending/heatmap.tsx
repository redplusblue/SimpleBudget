import { format, parseISO } from "date-fns";
import Link from "next/link";
import { formatCents } from "@/lib/finance/cents";
import type { DailySpend } from "@/lib/finance/spending-report-types";
import { cn } from "@/lib/utils";
import { spendingHref } from "./links";
import { calendarWeeks, heatScale, intensity } from "./heatmap-utils";
import { EmptyNote, Section } from "./section";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const SHADES = [
  "transparent",
  "color-mix(in oklab, var(--brand-from) 22%, transparent)",
  "color-mix(in oklab, var(--brand-from) 42%, transparent)",
  "color-mix(in oklab, var(--brand-from) 66%, transparent)",
  "var(--brand-from)",
];

/** Daily spending as a calendar. Each day opens that day's purchases. */
export function Heatmap({ days }: { days: DailySpend[] }) {
  const max = heatScale(days);
  const hasSpending = days.some((d) => d.cents > 0);
  const weeks = calendarWeeks(days);
  return (
    <Section id="heatmap" title="Daily spending" description="Darker days cost more. Tap a day to see what you bought.">
      {!hasSpending ? (
        <EmptyNote>No spending in this range.</EmptyNote>
      ) : (
        <div className="mx-auto w-full max-w-md" data-testid="heatmap">
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground" aria-hidden>
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="space-y-1" role="grid" aria-label="Spending by day">
            {weeks.map((week, wi) => (
              <div key={wi} role="row" className="grid grid-cols-7 gap-1">
                {week.map((d, di) => {
                  if (!d) return <span key={di} role="gridcell" aria-hidden />;
                  const level = intensity(d.cents, max);
                  const label = `${format(parseISO(d.date), "EEEE, MMMM d")}: ${d.future ? "hasn't happened yet" : d.cents > 0 ? `${formatCents(d.cents)} spent` : "nothing spent"}`;
                  const cell = (
                    <span
                      className={cn(
                        "grid aspect-square min-h-10 place-items-center rounded-lg border text-xs tabular-nums",
                        level === 0 ? "border-border text-muted-foreground" : "border-transparent",
                        level >= 3 && "text-white",
                        d.future && "opacity-40",
                      )}
                      style={{ background: SHADES[level] }}
                    >
                      {Number(d.date.slice(8))}
                    </span>
                  );
                  return (
                    <span key={di} role="gridcell">
                      {d.cents > 0 ? (
                        <Link
                          href={spendingHref({ from: d.date, to: d.date })}
                          aria-label={label}
                          title={label}
                          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                        >
                          {cell}
                        </Link>
                      ) : (
                        <span aria-label={label} title={label} className="block">
                          {cell}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground" aria-hidden>
            Less
            {SHADES.map((c, i) => (
              <span key={i} className="size-3.5 rounded border border-border" style={{ background: c }} />
            ))}
            More
          </div>
        </div>
      )}
    </Section>
  );
}
