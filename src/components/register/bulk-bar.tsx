"use client";

import { CheckCheck, EyeOff, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CategoryOption } from "@/lib/finance/taxonomy";
import type { BulkPatchInput } from "@/lib/finance/transaction-schemas";
import { TagPicker } from "./tag-picker";

/** Floating action bar shown while transactions are selected. */
export function BulkBar({
  count,
  categories,
  onApply,
  onClear,
}: {
  count: number;
  categories: CategoryOption[];
  onApply: (patch: BulkPatchInput["patch"]) => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-popover p-2.5 shadow-xl lg:bottom-6"
    >
      <span className="px-2 text-sm font-medium" aria-live="polite">
        {count} selected
      </span>
      <Select value="" onValueChange={(v) => onApply({ categoryId: v === "none" ? null : Number(v) })}>
        <SelectTrigger aria-label="Set category for selected" className="h-11 w-40 md:h-9">
          <SelectValue placeholder="Set category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Uncategorized</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <TagPicker onPick={(tag) => onApply({ addTagIds: [tag.id] })}>
        <Button variant="outline" className="h-11 md:h-9" aria-label="Add tag to selected">
          <Tag /> Tag
        </Button>
      </TagPicker>
      <Button variant="outline" className="h-11 md:h-9" onClick={() => onApply({ isReviewed: true })}>
        <CheckCheck /> Reviewed
      </Button>
      <Button variant="outline" className="h-11 md:h-9" onClick={() => onApply({ isExcluded: true })}>
        <EyeOff /> Exclude
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-11 md:size-9"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X />
      </Button>
    </div>
  );
}
