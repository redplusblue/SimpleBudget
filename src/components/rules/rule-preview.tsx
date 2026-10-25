"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Money } from "@/components/money";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useDebounced } from "@/hooks/use-debounced";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import type { TransactionRow } from "@/lib/finance/transaction-types";
import type { RuleInput } from "@/lib/rules/types";

interface PreviewResult {
  matched: number;
  changed: number;
  sample: TransactionRow[];
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/**
 * Live "Matches N existing transactions" for a (possibly unsaved) rule, with the most recent matches and how
 * many would actually change. `input` is null while the draft is incomplete.
 */
export function RulePreview({
  input,
  incompleteReason,
  overwrite,
  onOverwriteChange,
}: {
  input: RuleInput | null;
  incompleteReason?: string;
  overwrite: boolean;
  onOverwriteChange: (v: boolean) => void;
}) {
  const key = useDebounced(input ? JSON.stringify(input) : null, 400);
  const query = useQuery({
    queryKey: ["rule-preview", key, overwrite],
    queryFn: () =>
      fetchJson<PreviewResult>("/api/rules/preview", jsonBody("POST", { rule: JSON.parse(key!), overwrite })),
    enabled: key !== null,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
  const settling = key !== (input ? JSON.stringify(input) : null) || (query.isFetching && key !== null);

  return (
    <section aria-label="Preview" className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div aria-live="polite" className="min-w-0 text-sm">
          {input === null ? (
            <p className="text-muted-foreground">{incompleteReason ?? "Finish the rule to see what it matches."}</p>
          ) : query.isError ? (
            <p role="alert" className="text-negative">
              Couldn&apos;t preview this rule.
            </p>
          ) : query.data ? (
            <>
              <p data-testid="rule-preview-count" className="font-medium">
                Matches {plural(query.data.matched, "existing transaction")}
              </p>
              <p className="text-muted-foreground">
                {query.data.matched === 0
                  ? "Nothing in your history matches yet. It would still apply to new imports."
                  : query.data.changed === 0
                    ? "Applying it now wouldn't change anything."
                    : `Applying it now would update ${plural(query.data.changed, "transaction")}.`}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Checking…</p>
          )}
        </div>
        {settling && input !== null && (
          <Loader2
            className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
            aria-label="Updating preview"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="preview-overwrite" checked={overwrite} onCheckedChange={(v) => onOverwriteChange(v === true)} />
        <Label htmlFor="preview-overwrite" className="text-xs font-normal text-muted-foreground">
          When applying to existing transactions, replace categories and names that are already set
        </Label>
      </div>

      {input !== null && query.data && query.data.sample.length > 0 && (
        <ul
          className="divide-y divide-border/60 rounded-lg border border-border bg-card text-sm"
          data-testid="rule-preview-sample"
        >
          {query.data.sample.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.displayPayee}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.pending ? "Pending" : format(new Date(r.effectiveDate * 1000), "MMM d, yyyy")} · {r.accountName}
                </p>
              </div>
              <Money cents={r.amountCents} currency={r.currency} colorize className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
