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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AI_FEATURES, FEATURE_LABELS, parseModelListJson, type AiFeature, type ModelEntry } from "@/lib/llm/models";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { AI_CONFIG_KEY, useAiConfig, type AiConfig } from "./ai-config";
import { AI_USAGE_KEY } from "./ai-usage-card";

const UNSET = "__default";

/** The list only counts as explicit when it says more than the single fallback model. */
const explicitList = (cfg: AiConfig) =>
  cfg.models.length === 1 && cfg.models[0].id === cfg.model && Object.keys(cfg.models[0]).length === 1
    ? ""
    : JSON.stringify(cfg.models, null, 2);

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
  const [modelsText, setModelsText] = useState("");
  const [featureModels, setFeatureModels] = useState<Partial<Record<AiFeature, string>>>({});
  const [budget, setBudget] = useState("");

  useEffect(() => {
    if (!cfg) return;
    setEnabled(cfg.enabled);
    setModel(cfg.model);
    setBaseUrl(cfg.baseUrl);
    setIncludeBalances(cfg.includeBalances);
    setModelsText(explicitList(cfg));
    setFeatureModels(cfg.featureModels);
    setBudget(cfg.monthlyBudgetMicros === null ? "" : String(cfg.monthlyBudgetMicros / 1_000_000));
  }, [cfg]);

  // Parsed as the user types so the feature pickers offer unsaved models and Save is disabled while invalid.
  const parsedModels = (() => {
    if (!modelsText.trim()) return { list: null as ModelEntry[] | null, error: null as string | null };
    try {
      return { list: parseModelListJson(modelsText), error: null };
    } catch (e) {
      return { list: null, error: e instanceof Error ? e.message : "The model list isn't valid." };
    }
  })();
  const budgetNumber = budget.trim() === "" ? null : Number(budget);
  const budgetInvalid = budgetNumber !== null && (!Number.isFinite(budgetNumber) || budgetNumber < 0);
  const choices: ModelEntry[] = parsedModels.list ?? (model ? [{ id: model }] : []);

  const save = useMutation({
    mutationFn: (extra: { apiKey?: string | null } = {}) =>
      fetchJson(
        "/api/settings/ai",
        jsonBody("PUT", {
          enabled,
          model,
          baseUrl,
          includeBalances,
          models: parsedModels.list,
          featureModels: Object.keys(featureModels).length > 0 ? featureModels : null,
          monthlyBudgetMicros: budgetNumber === null ? null : Math.round(budgetNumber * 1_000_000),
          ...extra,
        }),
      ),
    onSuccess: () => {
      setApiKey("");
      setError(null);
      qc.invalidateQueries({ queryKey: AI_CONFIG_KEY });
      qc.invalidateQueries({ queryKey: ["ai-summary"] });
      qc.invalidateQueries({ queryKey: AI_USAGE_KEY });
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
            <Label htmlFor="ai-model">Default model</Label>
            <Input
              id="ai-model"
              placeholder="e.g. anthropic/claude-sonnet-4.5 or openai/gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-11 md:h-9"
              autoCapitalize="none"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">Used by any feature without its own choice below.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-models">Models you allow</Label>
            <Textarea
              id="ai-models"
              rows={6}
              className="font-mono text-xs"
              spellCheck={false}
              autoCapitalize="none"
              placeholder={
                '[\n  { "id": "google/gemini-2.5-flash-lite", "label": "Cheap" },\n  { "id": "anthropic/claude-sonnet-4.5", "label": "Smart" }\n]'
              }
              value={modelsText}
              onChange={(e) => setModelsText(e.target.value)}
              aria-invalid={parsedModels.error ? true : undefined}
            />
            {parsedModels.error && (
              <p role="alert" className="text-sm text-negative">
                {parsedModels.error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              One server and key are shared by all models. Add optional <code>inputPerMTok</code>/
              <code>outputPerMTok</code> (USD per million tokens) to estimate costs when your server doesn&apos;t report
              them. Leave empty to use only the default model.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Default model for each feature</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {AI_FEATURES.map((f) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={`ai-feature-${f}`} className="text-xs font-normal text-muted-foreground">
                    {FEATURE_LABELS[f]}
                  </Label>
                  <Select
                    value={featureModels[f] ?? UNSET}
                    onValueChange={(v) =>
                      setFeatureModels((prev) => {
                        const next = { ...prev };
                        if (v === UNSET) delete next[f];
                        else next[f] = v;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger id={`ai-feature-${f}`} className="h-11 w-full md:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Same as default ({model || "none"})</SelectItem>
                      {choices.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label ?? m.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="ai-budget">Monthly AI budget (USD)</Label>
            <Input
              id="ai-budget"
              inputMode="decimal"
              placeholder="No cap"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="h-11 md:h-9"
              aria-invalid={budgetInvalid ? true : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Every AI request is refused once this month&apos;s cost reaches it. Empty means no cap; <code>0</code>{" "}
              pauses all AI.
            </p>
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
            <Button
              type="submit"
              className="h-11 md:h-9"
              disabled={save.isPending || !!parsedModels.error || budgetInvalid}
            >
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
