"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { CurrencyUse } from "@/lib/finance/currency";

const KEY = ["currencies"] as const;

export function CurrencyPanel() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ currencies: CurrencyUse[] }>("/api/settings/currency")).currencies,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data)
      setValues(Object.fromEntries(query.data.map((c) => [c.currency, c.rate === null ? "" : String(c.rate)])));
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      const rates: Record<string, number> = {};
      for (const [code, text] of Object.entries(values)) {
        if (!text.trim()) continue;
        const n = Number(text.trim());
        if (!Number.isFinite(n)) throw new Error(`Enter ${code}'s rate as a number like 1.0856`);
        rates[code] = n;
      }
      return fetchJson("/api/settings/currency", jsonBody("PUT", { rates }));
    },
    onSuccess: () => {
      setError(null);
      for (const key of [KEY, ["dashboard"], ["networth"], ["accounts-overview"], ["account"]])
        qc.invalidateQueries({ queryKey: key });
      toast.success("Rates saved");
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save the rates"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currency</CardTitle>
        <CardDescription>
          SimpleBudget shows everything in US dollars. If some of your accounts hold another currency, set what one unit
          is worth in dollars and those balances are converted for net worth and account totals. The rate stays as you
          set it; it never updates by itself.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-24 w-full rounded-xl" aria-busy />
        ) : query.isError ? (
          <p role="alert" className="text-sm text-negative">
            Couldn&apos;t load this page.
          </p>
        ) : query.data.length === 0 ? (
          <EmptyState icon={Coins} title="All your accounts are in US dollars, so there's nothing to convert." />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              save.mutate();
            }}
          >
            {query.data.map((c) => (
              <div
                key={c.currency}
                className="grid items-center gap-2 sm:grid-cols-[1fr_auto]"
                data-testid="currency-row"
              >
                <Label htmlFor={`rate-${c.currency}`} className="text-sm">
                  1 {c.currency} ={" "}
                  <span className="text-muted-foreground">
                    ({c.accountCount} account{c.accountCount === 1 ? "" : "s"})
                  </span>
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`rate-${c.currency}`}
                    inputMode="decimal"
                    placeholder="e.g. 1.0856"
                    value={values[c.currency] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [c.currency]: e.target.value }))}
                    className="h-11 w-36 text-right md:h-9"
                  />
                  <span className="text-sm text-muted-foreground">USD</span>
                </div>
                {c.rate === null && (
                  <p className="text-xs text-warning sm:col-span-2">
                    No rate yet: these balances are counted 1 to 1 until you set one.
                  </p>
                )}
              </div>
            ))}
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" className="h-11 md:h-9" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />} Save rates
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
