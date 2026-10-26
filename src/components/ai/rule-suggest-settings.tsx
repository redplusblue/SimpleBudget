"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { RuleSuggestSettings } from "@/lib/ai/rule-settings";

const KEY = ["ai-rule-settings"] as const;

const SCHEDULES = [
  { value: "manual", label: "Only when I press the button" },
  { value: "after_sync", label: "After each sync" },
  { value: "interval", label: "Every N days" },
] as const;

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function RuleSuggestSettingsCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ settings: RuleSuggestSettings }>("/api/settings/ai/rules")).settings,
  });
  const saved = query.data;
  const [schedule, setSchedule] = useState<RuleSuggestSettings["schedule"]>("after_sync");
  const [days, setDays] = useState("7");
  const [min, setMin] = useState("5");
  const [max, setMax] = useState("100");
  const [tagRules, setTagRules] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    setSchedule(saved.schedule);
    setDays(String(saved.intervalDays));
    setMin(String(saved.minNewMerchants));
    setMax(String(saved.maxMerchantsPerRun));
    setTagRules(saved.suggestTags);
  }, [saved]);

  const save = useMutation({
    mutationFn: () =>
      fetchJson(
        "/api/settings/ai/rules",
        jsonBody("PUT", {
          schedule,
          intervalDays: clampInt(days, 1, 90, 7),
          minNewMerchants: clampInt(min, 1, 100, 5),
          maxMerchantsPerRun: clampInt(max, 1, 500, 100),
          suggestTags: tagRules,
        }),
      ),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Rule suggestion settings saved");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save the settings"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rule suggestions</CardTitle>
        <CardDescription>
          The AI proposes rules for merchants no rule covers. You accept or dismiss each one on the Rules page; nothing
          is changed without your say-so.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending && <Skeleton className="h-48 w-full rounded-xl" aria-busy />}
        {query.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load these settings.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {saved && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">When to look for new merchants</legend>
              {SCHEDULES.map((s) => (
                <label key={s.value} className="flex min-h-11 items-center gap-3 text-sm md:min-h-0">
                  <input
                    type="radio"
                    name="rule-schedule"
                    value={s.value}
                    checked={schedule === s.value}
                    onChange={() => setSchedule(s.value)}
                    className="size-4 accent-[var(--color-link,currentColor)]"
                  />
                  {s.label}
                </label>
              ))}
              {schedule === "interval" && (
                <div className="space-y-1 pl-7">
                  <Label htmlFor="rules-days" className="text-xs font-normal text-muted-foreground">
                    Days between runs (1-90)
                  </Label>
                  <Input
                    id="rules-days"
                    inputMode="numeric"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="h-11 w-28 md:h-9"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Background runs only happen with AI on, enough new merchants waiting, and budget left. Pick the first
                option to stop all background spending on this.
              </p>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rules-min">
                  Only run in the background when at least this many new merchants are waiting
                </Label>
                <Input
                  id="rules-min"
                  inputMode="numeric"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  className="h-11 w-28 md:h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rules-max">At most this many merchants per run</Label>
                <Input
                  id="rules-max"
                  inputMode="numeric"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  className="h-11 w-28 md:h-9"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
              <div>
                <Label htmlFor="rules-tags">Also suggest tag rules</Label>
                <p className="text-xs text-muted-foreground">Uses your existing tags only.</p>
              </div>
              <Switch id="rules-tags" checked={tagRules} onCheckedChange={setTagRules} />
            </div>

            <p className="text-xs text-muted-foreground">
              Last background run: {saved.lastRunAt ? new Date(saved.lastRunAt * 1000).toLocaleString() : "never"}
            </p>
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <div className="flex md:justify-end">
              <Button type="submit" className="h-11 w-full md:h-9 md:w-auto" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" />} Save suggestion settings
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
