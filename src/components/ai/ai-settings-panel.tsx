"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { AI_CONFIG_KEY, useAiConfig } from "./ai-config";

export function AiSettingsPanel() {
  const qc = useQueryClient();
  const query = useAiConfig();
  const cfg = query.data;

  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [includeBalances, setIncludeBalances] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg) return;
    setEnabled(cfg.enabled);
    setModel(cfg.model);
    setBaseUrl(cfg.baseUrl);
    setIncludeBalances(cfg.includeBalances);
  }, [cfg]);

  const save = useMutation({
    mutationFn: (extra: { apiKey?: string | null } = {}) =>
      fetchJson("/api/settings/ai", jsonBody("PUT", { enabled, model, baseUrl, includeBalances, ...extra })),
    onSuccess: () => {
      setApiKey("");
      setError(null);
      qc.invalidateQueries({ queryKey: AI_CONFIG_KEY });
      qc.invalidateQueries({ queryKey: ["ai-summary"] });
      toast.success("AI settings saved");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save the settings"),
  });

  const test = useMutation({
    mutationFn: () => fetchJson<{ ok: boolean }>("/api/settings/ai/test", { method: "POST" }),
    onSuccess: () => toast.success("Connected. The provider answered."),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "The test failed"),
  });

  if (query.isPending) return <Skeleton className="h-96 w-full rounded-2xl" aria-busy />;
  if (query.isError || !cfg)
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <span className="text-negative">Couldn&apos;t load the AI settings.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI summaries and questions</CardTitle>
        <CardDescription>
          Optional. Everything else in SimpleBudget works the same with this off, and the insights are always computed
          on your own server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate(apiKey.trim() ? { apiKey: apiKey.trim() } : {});
          }}
        >
          <div role="note" className="flex gap-3 rounded-xl border border-border bg-surface-2/50 p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />
            <p>
              <strong>Only aggregated data is sent</strong>: category totals, merchant totals, month-over-month changes
              and the insights shown on your Insights page. Account numbers, access URLs, raw bank descriptions, notes
              and balances are never sent unless you tick the box below. When you ask a question, the assistant can also
              look up at most 50 matching transactions (date, payee, amount, category).
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
            <div>
              <Label htmlFor="ai-enabled">Turn on AI features</Label>
              <p className="text-xs text-muted-foreground">
                Adds a monthly summary and an &ldquo;Ask about your spending&rdquo; box to Insights.
              </p>
            </div>
            <Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-url">Server address</Label>
            <Input
              id="ai-url"
              inputMode="url"
              placeholder="https://openrouter.ai/api/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-11 md:h-9"
              autoCapitalize="none"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Any server that speaks the OpenAI chat-completions API. OpenRouter:{" "}
              <code>https://openrouter.ai/api/v1</code>. Open WebUI: <code>http://your-host:3000/api</code>. Ollama:{" "}
              <code>http://localhost:11434/v1</code>.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              placeholder="e.g. anthropic/claude-sonnet-4.5 or openai/gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-11 md:h-9"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-key">
              API key <span className="font-normal text-muted-foreground">(not needed by some local servers)</span>
            </Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              placeholder={cfg.hasKey ? "Saved. Type a new key to replace it" : "Paste your key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-11 md:h-9"
            />
            <p className="text-xs text-muted-foreground">Stored encrypted on this server and never shown again.</p>
            {cfg.hasKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2"
                disabled={save.isPending}
                onClick={() => save.mutate({ apiKey: null })}
              >
                Remove saved key
              </Button>
            )}
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="ai-balances"
              checked={includeBalances}
              onCheckedChange={(v) => setIncludeBalances(v === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="ai-balances">Also share account names and balances</Label>
              <p className="text-xs text-muted-foreground">
                Lets the assistant comment on low balances and card utilization. Off by default.
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              disabled={test.isPending || !cfg.enabled}
              onClick={() => test.mutate()}
            >
              {test.isPending && <Loader2 className="animate-spin" />} Test connection
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
