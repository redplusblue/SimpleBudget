import { formatCents } from "@/lib/finance/cents";
import { cn } from "@/lib/utils";

export interface MoneyProps {
  cents: number;
  /** `auto` shows a minus only; `always` also shows +; `never` hides the sign. */
  sign?: "auto" | "always" | "never";
  /**
   * `true`: positive values are green, negative use the default text color.
   * `"strict"`: negative values are red as well.
   */
  colorize?: boolean | "strict";
  compact?: boolean;
  hideZeroCents?: boolean;
  currency?: string;
  className?: string;
}

/** The only component that renders money. Values carry `data-money` so privacy mode can blur them. */
export function Money({
  cents,
  sign = "auto",
  colorize = false,
  compact = false,
  hideZeroCents = false,
  currency,
  className,
}: MoneyProps) {
  const text = formatCents(cents, { signDisplay: sign, compact, hideZeroCents, currency });
  const tone =
    colorize && cents > 0 ? "text-positive" : colorize === "strict" && cents < 0 ? "text-negative" : undefined;
  return (
    <span data-money className={cn("tabular-nums", tone, className)}>
      {text}
    </span>
  );
}
