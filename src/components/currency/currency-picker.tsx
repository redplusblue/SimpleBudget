"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TOP_CURRENCIES } from "@/lib/finance/display-currency-types";
import { cn } from "@/lib/utils";
import { useDisplayCurrency } from "./display-currency";

const names = (() => {
  try {
    return new Intl.DisplayNames("en", { type: "currency" });
  } catch {
    return null;
  }
})();
export const currencyName = (code: string) => names?.of(code) ?? code;

/** Top-bar button (hidden while the feature is off) that opens the list of currencies to show amounts in. */
export function CurrencyPicker() {
  const { state, update } = useDisplayCurrency();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { top, rest } = useMemo(() => {
    const top = TOP_CURRENCIES.filter((c) => state.available.includes(c));
    const rest = state.available.filter((c) => !(TOP_CURRENCIES as readonly string[]).includes(c));
    const q = query.trim().toLowerCase();
    const match = (c: string) => !q || c.toLowerCase().includes(q) || currencyName(c).toLowerCase().includes(q);
    return { top: top.filter(match), rest: rest.filter(match) };
  }, [state.available, query]);

  if (!state.enabled) return null;

  async function choose(code: string) {
    try {
      await update({ code });
      setOpen(false);
      setQuery("");
    } catch {
      toast.error("Couldn't switch currency");
    }
  }

  const row = (code: string) => (
    <button
      key={code}
      type="button"
      onClick={() => void choose(code)}
      aria-pressed={state.code === code}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface-2 md:min-h-9",
        state.code === code && "bg-surface-2",
      )}
    >
      <span className="w-10 font-medium">{code}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{currencyName(code)}</span>
      {state.code === code && <Check className="size-4" />}
    </button>
  );

  return (
    <>
      <Button
        variant="ghost"
        className="h-11 px-2 font-medium md:h-9"
        aria-label={`Display currency: ${state.code}. Change`}
        title="Change display currency"
        onClick={() => setOpen(true)}
      >
        {state.code}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Show amounts in</DialogTitle>
            <DialogDescription>
              Display only: your data stays in US dollars
              {state.updatedAt
                ? `. Rates from ${new Date(state.updatedAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
                : "."}
            </DialogDescription>
          </DialogHeader>
          {state.available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No exchange rates yet. They download once a day, or use Refresh in Settings → Currency.
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search currencies"
                  aria-label="Search currencies"
                  className="h-11 pl-9 md:h-9"
                />
              </div>
              <div className="max-h-[50dvh] space-y-0.5 overflow-y-auto" data-testid="currency-list">
                {top.map(row)}
                {top.length > 0 && rest.length > 0 && <div className="my-2 border-t border-border" />}
                {rest.map(row)}
                {top.length + rest.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No match.</p>}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
