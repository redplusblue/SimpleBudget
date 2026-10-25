"use client";

import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { moveItem } from "@/lib/reorder";
import { cn } from "@/lib/utils";

export interface SortableControls {
  /** Drag grip plus up/down buttons; render this where the handle should appear. */
  handle: React.ReactNode;
  isDragging: boolean;
}

/**
 * A reorderable list. Desktop users can drag the grip (native HTML5 drag and drop, so no extra library);
 * everyone, including touch and keyboard users, gets "move up / move down" buttons.
 */
export function SortableList<T extends { id: number }>({
  items,
  onReorder,
  renderItem,
  getLabel,
  className,
}: {
  items: T[];
  /** Called with the new order of ids. */
  onReorder: (ids: number[]) => void;
  renderItem: (item: T, controls: SortableControls) => React.ReactNode;
  getLabel: (item: T) => string;
  className?: string;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; place: "before" | "after" } | null>(null);
  const rows = useRef(new Map<number, HTMLLIElement>());

  const commit = (next: T[]) => {
    if (next.some((n, i) => n.id !== items[i]?.id)) onReorder(next.map((n) => n.id));
  };

  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, index) => {
        const isOver = over?.id === item.id && dragId !== null && dragId !== item.id;
        const label = getLabel(item);
        const handle = (
          <span className="flex shrink-0 items-center">
            <span
              draggable
              role="img"
              aria-label={`Drag to reorder ${label}`}
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(item.id));
                const row = rows.current.get(item.id);
                if (row) e.dataTransfer.setDragImage(row, 16, 16);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOver(null);
              }}
              className="hidden size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 active:cursor-grabbing md:flex"
            >
              <GripVertical className="size-4" />
            </span>
            <span className="flex">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 md:size-7"
                disabled={index === 0}
                aria-label={`Move ${label} up`}
                onClick={() => commit(moveItem(items, item.id, items[index - 1].id, "before"))}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 md:size-7"
                disabled={index === items.length - 1}
                aria-label={`Move ${label} down`}
                onClick={() => commit(moveItem(items, item.id, items[index + 1].id, "after"))}
              >
                <ArrowDown className="size-4" />
              </Button>
            </span>
          </span>
        );
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el);
              else rows.current.delete(item.id);
            }}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              setOver({ id: item.id, place: e.clientY < box.top + box.height / 2 ? "before" : "after" });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId !== null && over) commit(moveItem(items, dragId, over.id, over.place));
              setDragId(null);
              setOver(null);
            }}
            className={cn(
              "relative transition-opacity",
              dragId === item.id && "opacity-40",
              isOver &&
                over?.place === "before" &&
                "before:absolute before:-top-1.5 before:right-0 before:left-0 before:h-0.5 before:rounded before:bg-primary",
              isOver &&
                over?.place === "after" &&
                "after:absolute after:right-0 after:-bottom-1.5 after:left-0 after:h-0.5 after:rounded after:bg-primary",
            )}
          >
            {renderItem(item, { handle, isDragging: dragId === item.id })}
          </li>
        );
      })}
    </ul>
  );
}
