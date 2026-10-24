import { useId } from "react";

/** Tiny dependency-free trend line. Needs at least two points; otherwise draws a flat dashed line. */
export function Sparkline({
  values,
  width = 96,
  height = 32,
  className,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Accessible description, e.g. "Balance over the last 30 days". */
  label?: string;
}) {
  const gradientId = useId();
  const pad = 2;
  if (values.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        role="img"
        aria-label={label ? `${label}: not enough history yet` : undefined}
        aria-hidden={label ? undefined : true}
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${(max === min ? height / 2 : y(v)).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
