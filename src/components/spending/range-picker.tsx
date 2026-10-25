"use client";

import { endOfMonth, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { shiftMonth } from "@/lib/finance/dates";
import { currentMonthLocal, customPresets, type RangeState } from "./range-state";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const monthName = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return format(new Date(y, m - 1, 1), "MMMM yyyy");
};

/** ‹ October 2026 › with a Month / Custom toggle. */
export function RangePicker({ value, onChange }: { value: RangeState; onChange: (next: RangeState) => void }) {
  const thisMonth = currentMonthLocal();
  const month = value.kind === "month" ? value.month : value.from.slice(0, 7);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={value.kind}
          onValueChange={(v) => {
            if (v === "month") onChange({ kind: "month", month: month || thisMonth });
            if (v === "custom") onChange(value.kind === "custom" ? value : customFromMonth(value.month));
          }}
          aria-label="Range type"
        >
          <ToggleGroupItem value="month" className="h-11 px-4 md:h-9">
            Month
          </ToggleGroupItem>
          <ToggleGroupItem value="custom" className="h-11 px-4 md:h-9">
            Custom
          </ToggleGroupItem>
        </ToggleGroup>

        {value.kind === "month" && (
          <div className="flex items-center gap-1" role="group" aria-label="Month">
            <Button
              variant="outline"
              size="icon"
              className="size-11 md:size-9"
              aria-label="Previous month"
              onClick={() => onChange({ kind: "month", month: shiftMonth(value.month, -1) })}
            >
              <ChevronLeft />
            </Button>
            <span
              data-testid="range-label"
              aria-live="polite"
              className="min-w-36 px-2 text-center text-base font-semibold"
            >
              {monthName(value.month)}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-11 md:size-9"
              aria-label="Next month"
              disabled={value.month >= thisMonth}
              onClick={() => onChange({ kind: "month", month: shiftMonth(value.month, 1) })}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      {value.kind === "custom" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label="From date"
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
              className="h-11 w-auto md:h-9"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              value={value.to}
              min={value.from}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
              className="h-11 w-auto md:h-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {customPresets().map((p) => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                className="h-9 rounded-full px-3 text-xs"
                onClick={() => onChange({ kind: "custom", from: p.from, to: p.to })}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** When switching from a month to a custom range, start with that month (up to today). */
function customFromMonth(month: string): RangeState {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = endOfMonth(first);
  const today = new Date();
  return { kind: "custom", from: ymd(first), to: ymd(last > today ? today : last) };
}
