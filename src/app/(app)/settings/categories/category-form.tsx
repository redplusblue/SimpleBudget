"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { CATEGORY_ICONS, CategoryBadge } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CHART_PALETTE } from "@/db/palette";
import { CATEGORY_ICON_NAMES, type CategoryIconName } from "@/lib/finance/category-icons";
import type { CategoryAdminRow } from "@/lib/finance/taxonomy-schemas";
import { cn } from "@/lib/utils";

export interface CategoryFormValues {
  name: string;
  groupName: string | null;
  color: string;
  icon: CategoryIconName | null;
  isIncome: boolean;
}

/** Create / edit form for a category: name, group, color from the palette, icon, and whether it counts as income. */
export function CategoryForm({
  initial,
  groups,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: CategoryAdminRow;
  groups: string[];
  busy: boolean;
  error: string | null;
  onSubmit: (values: CategoryFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [groupName, setGroupName] = useState(initial?.groupName ?? "");
  const [color, setColor] = useState(initial?.color ?? CHART_PALETTE[0]);
  const [icon, setIcon] = useState<CategoryIconName | null>((initial?.icon as CategoryIconName | null) ?? null);
  const [isIncome, setIsIncome] = useState(initial?.isIncome ?? false);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, groupName: groupName.trim() || null, color, icon, isIncome });
      }}
    >
      <div className="flex items-center gap-3">
        <CategoryBadge icon={icon} color={color} className="size-12" />
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            autoFocus
            className="h-11 md:h-9"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cat-group">Group (optional)</Label>
        <Input
          id="cat-group"
          list="category-groups"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          maxLength={40}
          placeholder="e.g. Food, Living"
          className="h-11 md:h-9"
        />
        <datalist id="category-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </div>

      <div className="space-y-2">
        <Label>Color</Label>
        <div role="radiogroup" aria-label="Category color" className="flex flex-wrap gap-2">
          {CHART_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                "size-9 rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                color === c ? "scale-110 border-foreground" : "border-transparent",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Icon</Label>
        <div role="radiogroup" aria-label="Category icon" className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
          {CATEGORY_ICON_NAMES.map((n) => {
            const Icon = CATEGORY_ICONS[n];
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={icon === n}
                aria-label={n.replace(/-/g, " ")}
                onClick={() => setIcon(n)}
                className={cn(
                  "grid aspect-square place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  icon === n ? "border-primary bg-primary/10 text-foreground" : "border-border",
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
        <Label htmlFor="cat-income" className="flex-col items-start gap-0.5 text-sm font-medium">
          Income category
          <span className="text-xs font-normal text-muted-foreground">
            Money filed here counts as income, not spending.
          </span>
        </Label>
        <Switch id="cat-income" checked={isIncome} onCheckedChange={setIsIncome} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 md:h-9" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="animate-spin" />} {initial ? "Save" : "Add category"}
        </Button>
      </div>
    </form>
  );
}
