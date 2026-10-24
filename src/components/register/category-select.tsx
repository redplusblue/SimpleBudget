"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  // Mounting a Radix Select per row is the most expensive part of rendering a long list, so compact
  // (in-row) pickers start as a lightweight button and only become a real Select once used.
  const [armed, setArmed] = useState(!compact);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The real trigger mounts in place of the button, so hand focus to it (Radix closes a menu opened without focus on its trigger).
  const wasLazy = useRef(compact);
  useEffect(() => {
    if (armed && wasLazy.current) {
      wasLazy.current = false;
      triggerRef.current?.focus();
      setOpen(true); // open after the real Select has mounted closed, like a normal user click would
    }
  }, [armed]);
  const label = current ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <Dot color={current.color} />
      <span className="truncate">{current.name}</span>
    </span>
  ) : (
    "Uncategorized"
  );
  if (!armed) {
    return (
      <div
        className={cn("min-w-0", className)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          role="combobox"
          aria-expanded={false}
          aria-haspopup="listbox"
          aria-controls={undefined}
          aria-label={ariaLabel}
          onClick={() => setArmed(true)}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-1.5 rounded-full border border-transparent bg-surface-2 px-2.5 text-xs whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            !current && "text-muted-foreground",
          )}
        >
          {label}
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <div
      className={cn("min-w-0", className)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Select
        open={open}
        onOpenChange={setOpen}
        value={value === null ? NONE : String(value)}
        onValueChange={(v) => onChange(v === NONE ? null : Number(v))}
      >
        <SelectTrigger
          ref={triggerRef}
          aria-label={ariaLabel}
          className={cn(
            "w-full gap-1.5",
            compact
              ? "h-8 rounded-full border-transparent bg-surface-2 px-2.5 text-xs shadow-none md:h-8"
              : "h-11 md:h-9",
            !current && compact && "text-muted-foreground",
          )}
        >
          <SelectValue>{label}</SelectValue>
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
