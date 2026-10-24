"use client";

import { ArrowLeftRight, EyeOff, StickyNote } from "lucide-react";
import { memo, useRef } from "react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { CategoryOption } from "@/lib/finance/taxonomy";
import type { TransactionRow } from "@/lib/finance/transaction-types";
import { cn } from "@/lib/utils";
import { CategorySelect } from "./category-select";

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

export interface RowProps {
  row: TransactionRow;
  categories: CategoryOption[];
  showAccount: boolean;
  showBalance: boolean;
  /** Render the two-line mobile layout instead of the desktop columns. */
  mobile: boolean;
  selected: boolean;
  selectionMode: boolean;
  onOpen: (id: number) => void;
  onToggleSelect: (id: number) => void;
  onLongPress: (id: number) => void;
  onCategoryChange: (id: number, categoryId: number | null) => void;
}

/** Grid template for the desktop layout. */
export const desktopColumns = (showBalance: boolean) =>
  `28px minmax(0,1fr) 190px minmax(0,150px) 108px${showBalance ? " 112px" : ""}`;

function Flags({ row }: { row: TransactionRow }) {
  return (
    <>
      {row.pending && (
        <Badge variant="outline" className="h-5 shrink-0 border-warning/40 px-1.5 text-[10px] text-warning">
          Pending
        </Badge>
      )}
      {row.isTransfer && (
        <Badge variant="outline" className="h-5 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground">
          <ArrowLeftRight className="size-3" aria-hidden /> Transfer
        </Badge>
      )}
      {row.isExcluded && (
        <span title="Excluded from stats" className="shrink-0 text-muted-foreground">
          <EyeOff className="size-3.5" aria-label="Excluded from stats" />
        </span>
      )}
      {row.notes && (
        <span title={row.notes} className="shrink-0 text-muted-foreground">
          <StickyNote className="size-3.5" aria-label="Has a note" />
        </span>
      )}
    </>
  );
}

function TagChips({ row, max }: { row: TransactionRow; max: number }) {
  if (row.tags.length === 0) return null;
  const shown = row.tags.slice(0, max);
  const extra = row.tags.length - shown.length;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.map((t) => (
        <span
          key={t.id}
          className="inline-flex max-w-24 items-center gap-1 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: t.color }} />
          <span className="truncate">{t.name}</span>
        </span>
      ))}
      {extra > 0 && <span className="text-[11px] text-muted-foreground">+{extra}</span>}
    </span>
  );
}

function TransactionRowView({
  row,
  categories,
  showAccount,
  showBalance,
  mobile,
  selected,
  selectionMode,
  onOpen,
  onToggleSelect,
  onLongPress,
  onCategoryChange,
}: RowProps) {
  // Long-press (touch only) starts selection; movement or release cancels it.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      suppressClick.current = false;
      press.current = {
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          suppressClick.current = true;
          press.current = null;
          navigator.vibrate?.(10);
          onLongPress(row.id);
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onClick: () => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      if (selectionMode) onToggleSelect(row.id);
      else onOpen(row.id);
    },
    // Touch long-press would otherwise open the browser's context menu on top of selection.
    onContextMenu: (e: React.MouseEvent) => {
      if (press.current || suppressClick.current) e.preventDefault();
    },
  };

  const amount = (
    <Money
      cents={row.amountCents}
      currency={row.currency}
      colorize
      sign="auto"
      className={cn("font-medium", (row.isTransfer || row.isExcluded) && "text-muted-foreground")}
    />
  );
  const payee = (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        className="min-w-0 truncate text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          if (selectionMode) onToggleSelect(row.id);
          else onOpen(row.id);
        }}
        aria-label={`${row.displayPayee}, ${row.amountCents < 0 ? "spent" : "received"}. Open details`}
      >
        {row.displayPayee}
      </button>
      <Flags row={row} />
    </span>
  );
  const checkbox = (
    <Checkbox
      checked={selected}
      onCheckedChange={() => onToggleSelect(row.id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Select ${row.displayPayee}`}
    />
  );

  return (
    <div
      {...handlers}
      data-testid="txn-row"
      data-id={row.id}
      data-selected={selected || undefined}
      className={cn(
        "cursor-pointer border-b border-border/60 px-3 transition-colors select-none hover:bg-surface-2/60 md:select-auto",
        selected && "bg-primary/10 hover:bg-primary/15",
        row.pending && "bg-surface-2/30",
      )}
    >
      {mobile ? (
        <div className="flex min-h-16 items-center gap-3 py-2">
          {selectionMode && checkbox}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              {payee}
              <span className="shrink-0">{amount}</span>
            </div>
            <div className="flex items-center gap-2">
              <CategorySelect
                value={row.categoryId}
                categories={categories}
                onChange={(c) => onCategoryChange(row.id, c)}
                compact
                className="max-w-[55%]"
                aria-label={`Category for ${row.displayPayee}`}
              />
              {showAccount && <span className="truncate text-xs text-muted-foreground">{row.accountName}</span>}
              <TagChips row={row} max={1} />
            </div>
          </div>
        </div>
      ) : (
        <div
          className="grid min-h-14 items-center gap-3 py-1.5"
          style={{ gridTemplateColumns: desktopColumns(showBalance) }}
        >
          <span className="flex items-center">{checkbox}</span>
          <div className="min-w-0">
            {payee}
            {showAccount && <p className="truncate text-xs text-muted-foreground">{row.accountName}</p>}
          </div>
          <CategorySelect
            value={row.categoryId}
            categories={categories}
            onChange={(c) => onCategoryChange(row.id, c)}
            compact
            aria-label={`Category for ${row.displayPayee}`}
          />
          <TagChips row={row} max={2} />
          <span className="text-right">{amount}</span>
          {showBalance && (
            <span className="text-right text-sm text-muted-foreground">
              {row.runningBalanceCents !== null ? (
                <Money cents={row.runningBalanceCents} currency={row.currency} />
              ) : null}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export const TransactionRowItem = memo(TransactionRowView);
