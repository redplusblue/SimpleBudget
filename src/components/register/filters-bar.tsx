"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAccountsOverview, useCategories, useTags } from "@/hooks/use-lookups";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import { countActiveFilters } from "@/lib/finance/transaction-params";
import type { TransactionFilters } from "@/lib/finance/transaction-types";
import { cn } from "@/lib/utils";
import { DATE_PRESET_LABELS, detectPreset, presetRange, type DatePreset } from "./filter-presets";

const ALL = "all";

interface Props {
  filters: TransactionFilters;
  onChange: (patch: Partial<TransactionFilters>) => void;
  onClear: () => void;
  /** Hide the account filter (when the register is already scoped to one account). */
  scopedToAccount?: boolean;
}

/** Search box + filters. Inline on desktop; on mobile the filters live in a bottom drawer. */
export function FiltersBar({ filters, onChange, onClear, scopedToAccount }: Props) {
  const [open, setOpen] = useState(false);
  const active = countActiveFilters(filters);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SearchBox value={filters.q ?? ""} onCommit={(q) => onChange({ q: q || undefined })} />
        <Button
          variant="outline"
          className="relative h-11 shrink-0 gap-2 md:hidden"
          onClick={() => setOpen(true)}
          aria-label={active ? `Filters, ${active} active` : "Filters"}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {active > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {active}
            </span>
          )}
        </Button>
      </div>

      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <FilterControls filters={filters} onChange={onChange} scopedToAccount={scopedToAccount} layout="inline" />
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
            <X /> Clear
          </Button>
        )}
      </div>

      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Filters">
        <div className="max-h-[70dvh] space-y-4 overflow-y-auto pb-2">
          <FilterControls filters={filters} onChange={onChange} scopedToAccount={scopedToAccount} layout="stacked" />
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="h-11 flex-1" onClick={onClear} disabled={active === 0}>
            Clear all
          </Button>
          <Button className="h-11 flex-1" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
}

function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const [text, setText] = useState(value);
  // Follow external changes (e.g. "Clear"), then debounce our own typing.
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => onCommit(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text, value, onCommit]);

  return (
    <div className="relative min-w-0 flex-1 md:max-w-sm">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label="Search transactions"
        placeholder="Search payee, notes, amount…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-11 pl-9 md:h-9"
        data-search-input
      />
    </div>
  );
}

function Field({
  label,
  layout,
  children,
}: {
  label: string;
  layout: "inline" | "stacked";
  children: React.ReactNode;
}) {
  if (layout === "inline") return <>{children}</>;
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function FilterControls({
  filters,
  onChange,
  scopedToAccount,
  layout,
}: Omit<Props, "onClear"> & { layout: "inline" | "stacked" }) {
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { data: groups = [] } = useAccountsOverview();
  const accounts = useMemo(() => groups.flatMap((g) => g.accounts), [groups]);
  const triggerClass = cn("w-full md:w-auto", layout === "stacked" ? "h-11" : "h-9 md:min-w-36");
  const preset = detectPreset(filters.from, filters.to);

  return (
    <>
      <Field label="Date" layout={layout}>
        <DateRangeControl
          filters={filters}
          preset={preset}
          onChange={onChange}
          triggerClass={triggerClass}
          layout={layout}
        />
      </Field>

      <Field label="Category" layout={layout}>
        <Select
          value={filters.categoryId === undefined ? ALL : String(filters.categoryId)}
          onValueChange={(v) => onChange({ categoryId: v === ALL ? undefined : v === "none" ? "none" : Number(v) })}
        >
          <SelectTrigger aria-label="Category filter" className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value="none">Uncategorized</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Type" layout={layout}>
        <ToggleGroup
          type="single"
          variant="outline"
          value={filters.type ?? ALL}
          onValueChange={(v) => v && onChange({ type: v === ALL ? undefined : (v as TransactionFilters["type"]) })}
          aria-label="Transaction type"
          className={layout === "stacked" ? "w-full" : undefined}
        >
          {[
            [ALL, "All"],
            ["expense", "Expenses"],
            ["income", "Income"],
            ["transfer", "Transfers"],
          ].map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className={layout === "stacked" ? "h-11 flex-1" : "h-9 px-3"}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field label="Tag" layout={layout}>
        <Select
          value={filters.tagId === undefined ? ALL : String(filters.tagId)}
          onValueChange={(v) => onChange({ tagId: v === ALL ? undefined : Number(v) })}
        >
          <SelectTrigger aria-label="Tag filter" className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Amount" layout={layout}>
        <AmountRange filters={filters} onChange={onChange} triggerClass={triggerClass} layout={layout} />
      </Field>

      <Field label="Status" layout={layout}>
        <Select
          value={filters.status ?? ALL}
          onValueChange={(v) => onChange({ status: v === ALL ? undefined : (v as TransactionFilters["status"]) })}
        >
          <SelectTrigger aria-label="Status filter" className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="unreviewed">Unreviewed</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {!scopedToAccount && (
        <Field label="Account" layout={layout}>
          <Select
            value={filters.accountId ?? ALL}
            onValueChange={(v) => onChange({ accountId: v === ALL ? undefined : v })}
          >
            <SelectTrigger aria-label="Account filter" className={triggerClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </>
  );
}

function DateRangeControl({
  filters,
  preset,
  onChange,
  triggerClass,
  layout,
}: {
  filters: TransactionFilters;
  preset: DatePreset;
  onChange: Props["onChange"];
  triggerClass: string;
  layout: "inline" | "stacked";
}) {
  const [custom, setCustom] = useState(preset === "custom");
  useEffect(() => setCustom(preset === "custom"), [preset]);
  const showCustom = custom || preset === "custom";

  return (
    <div className={cn("flex flex-col gap-2", layout === "inline" && "md:flex-row md:items-center")}>
      <Select
        value={showCustom ? "custom" : preset}
        onValueChange={(v) => {
          if (v === "custom") {
            setCustom(true);
            return;
          }
          setCustom(false);
          const r = presetRange(v as Exclude<DatePreset, "custom">);
          onChange({ from: r.from, to: r.to });
        }}
      >
        <SelectTrigger aria-label="Date range" className={triggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DATE_PRESET_LABELS) as Array<keyof typeof DATE_PRESET_LABELS>).map((k) => (
            <SelectItem key={k} value={k}>
              {DATE_PRESET_LABELS[k]}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom range…</SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(e) => onChange({ from: e.target.value || undefined })}
            className="h-11 md:h-9"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To date"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(e) => onChange({ to: e.target.value || undefined })}
            className="h-11 md:h-9"
          />
        </div>
      )}
    </div>
  );
}

const toDollars = (cents: number | undefined) => (cents === undefined ? "" : centsToDecimalString(cents));

function AmountRange({
  filters,
  onChange,
  triggerClass,
  layout,
}: {
  filters: TransactionFilters;
  onChange: Props["onChange"];
  triggerClass: string;
  layout: "inline" | "stacked";
}) {
  const set = (key: "minAmountCents" | "maxAmountCents", raw: string) => {
    const t = raw.trim();
    if (!t) return onChange({ [key]: undefined });
    try {
      onChange({ [key]: Math.abs(parseCents(t.replace(/^\$/, ""))) });
    } catch {
      /* ignore partial input like "1." until it parses */
    }
  };
  const fields = (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor={`min-${layout}`} className="text-xs text-muted-foreground">
          Min ($)
        </Label>
        <Input
          id={`min-${layout}`}
          inputMode="decimal"
          placeholder="0"
          defaultValue={toDollars(filters.minAmountCents)}
          key={`min-${filters.minAmountCents ?? ""}`}
          onBlur={(e) => set("minAmountCents", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && set("minAmountCents", e.currentTarget.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`max-${layout}`} className="text-xs text-muted-foreground">
          Max ($)
        </Label>
        <Input
          id={`max-${layout}`}
          inputMode="decimal"
          placeholder="Any"
          defaultValue={toDollars(filters.maxAmountCents)}
          key={`max-${filters.maxAmountCents ?? ""}`}
          onBlur={(e) => set("maxAmountCents", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && set("maxAmountCents", e.currentTarget.value)}
          className="h-11 md:h-9"
        />
      </div>
    </div>
  );
  if (layout === "stacked") return fields;

  const active = filters.minAmountCents !== undefined || filters.maxAmountCents !== undefined;
  const label = active
    ? `${filters.minAmountCents !== undefined ? `$${toDollars(filters.minAmountCents)}` : "Any"} – ${filters.maxAmountCents !== undefined ? `$${toDollars(filters.maxAmountCents)}` : "Any"}`
    : "Amount";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(triggerClass, "justify-between font-normal", !active && "text-muted-foreground")}
          aria-label="Amount filter"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <p className="mb-2 text-xs text-muted-foreground">Absolute amount, ignoring sign.</p>
        {fields}
      </PopoverContent>
    </Popover>
  );
}
