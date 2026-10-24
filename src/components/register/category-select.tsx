"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CategoryOption } from "@/lib/finance/taxonomy";
import { cn } from "@/lib/utils";

const NONE = "none";

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/**
 * Category picker. In a row it's a compact pill; events are stopped from reaching the row (the menu
 * renders in a portal, but React events still bubble through it to the row's click handler).
 */
export function CategorySelect({
  value,
  categories,
  onChange,
  compact,
  className,
  "aria-label": ariaLabel = "Category",
  allowNone = true,
}: {
  value: number | null;
  categories: CategoryOption[];
  onChange: (id: number | null) => void;
  compact?: boolean;
  className?: string;
  "aria-label"?: string;
  allowNone?: boolean;
}) {
  const current = categories.find((c) => c.id === value);
  return (
    <div
      className={cn("min-w-0", className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Select
        value={value === null ? NONE : String(value)}
        onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className={cn(
            "w-full gap-1.5",
            compact
              ? "h-8 rounded-full border-transparent bg-surface-2 px-2.5 text-xs shadow-none md:h-8"
              : "h-11 md:h-9",
            !current && compact && "text-muted-foreground",
          )}
        >
          <SelectValue>
            {current ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Dot color={current.color} />
                <span className="truncate">{current.name}</span>
              </span>
            ) : (
              "Uncategorized"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>Uncategorized</SelectItem>}
          {categories.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              <span className="flex items-center gap-2">
                <Dot color={c.color} />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
