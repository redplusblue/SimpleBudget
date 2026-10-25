import Link from "next/link";
import { Money } from "@/components/money";

export interface RankedRow {
  key: string;
  name: string;
  color: string | null;
  cents: number;
  count: number;
  href: string;
  /** Optional right-hand note, e.g. "avg $25.00". */
  note?: string;
}

/** A ranked list with a bar behind each name, scaled to the largest value. Used for tags and accounts. */
export function RankedBars({ rows, testId }: { rows: RankedRow[]; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="space-y-1" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <Link
            href={r.href}
            className="relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-sm outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span
              aria-hidden
              className="absolute inset-y-1 left-0 rounded-md opacity-20"
              style={{ width: `${(r.cents / max) * 100}%`, background: r.color ?? "var(--brand-from)" }}
            />
            <span
              aria-hidden
              className="relative size-2.5 shrink-0 rounded-full"
              style={{ background: r.color ?? "var(--brand-from)" }}
            />
            <span className="relative min-w-0 flex-1 truncate">{r.name}</span>
            <span className="relative shrink-0 text-xs text-muted-foreground">
              {r.count} purchase{r.count === 1 ? "" : "s"}
              {r.note ? ` · ${r.note}` : ""}
            </span>
            <Money cents={r.cents} className="relative w-24 shrink-0 text-right font-medium" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
