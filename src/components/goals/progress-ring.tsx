import { cn } from "@/lib/utils";

/** A circular progress indicator with the percentage in the middle. Decorative: the numbers are written out beside it. */
export function ProgressRing({
  fraction,
  size = 72,
  stroke = 8,
  className,
  done,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  className?: string;
  done?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? "var(--positive)" : "var(--brand-from)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, fraction)))}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}
