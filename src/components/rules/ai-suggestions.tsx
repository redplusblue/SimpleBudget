"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAiConfig } from "@/components/ai/ai-config";
import { ModelPicker } from "@/components/ai/model-picker";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { useCategories } from "@/hooks/use-lookups";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { ProposalView } from "@/lib/ai/proposal-types";
import type { SuggestPlan } from "@/lib/ai/rule-suggestions";

const PENDING_KEY = ["ai-proposals", "pending"] as const;
const DISMISSED_KEY = ["ai-proposals", "dismissed"] as const;
const planKey = (model: string | undefined) => ["ai-rule-plan", model ?? ""] as const;

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
const dollars = (micros: number) =>
  micros < 10_000 ? `$${(micros / 1_000_000).toFixed(4)}` : `$${(micros / 1_000_000).toFixed(2)}`;

function Suggestion(props: {
  item: ProposalView;
  categoryId: number | undefined;
  onCategory: (id: number) => void;
  onAccept: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const { item: p } = props;
  const { data: categories = [] } = useCategories();
  const m = p.payload.merchant;
  const a = p.payload.action;
  const wording =
    p.payload.target.mode === "extend"
      ? `Adds "payee ${p.payload.pattern.op === "equals" ? "is" : "contains"} ${p.payload.pattern.value}" to rule ${p.payload.target.ruleName}`
      : `New rule ${p.payload.target.ruleName}`;
  const conflicts = p.preview?.conflicts ?? 0;
  return (
    <li className="space-y-2 rounded-2xl border border-border p-3" data-testid="ai-suggestion">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium break-words">{m.name}</p>
          <p className="text-xs break-words text-muted-foreground">{m.sample}</p>
          <p className="text-xs text-muted-foreground">
            {m.count}× · typically <Money cents={m.medianCents} />
          </p>
        </div>
        {p.confidence && <Badge variant="outline">{p.confidence} confidence</Badge>}
      </div>
      {a.type === "category" ? (
        <div className="flex items-center gap-2">
          <span aria-hidden>→</span>
          <Select value={String(props.categoryId ?? a.categoryId)} onValueChange={(v) => props.onCategory(Number(v))}>
            <SelectTrigger aria-label={`Category for ${m.name}`} className="h-11 w-full max-w-64 md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories
                .filter((c) => !c.isArchived || c.id === a.categoryId)
                .map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm">
          → tag <Badge variant="secondary">{a.tagName}</Badge>
        </p>
      )}
      <p className="text-xs text-muted-foreground">{wording}</p>
      {p.preview && (
        <p className="text-xs text-muted-foreground">
          Matches {p.preview.matched} · fills {p.preview.wouldChange}
        </p>
      )}
      {conflicts > 0 && p.preview && (
        <p className="text-xs text-negative">
          {conflicts} of these {conflicts === 1 ? "is" : "are"} already categorized differently (
          {[...new Set(p.preview.conflictSamples.map((s) => s.category))].join(", ")}).
        </p>
      )}
      {!p.stillValid && <p className="text-xs text-negative">{p.problem}</p>}
      <div className="flex gap-2">
        {p.stillValid && (
          <Button className="h-11 md:h-9" onClick={props.onAccept} disabled={props.busy}>
            <Check /> Accept
          </Button>
        )}
        <Button variant="outline" className="h-11 md:h-9" onClick={props.onDismiss} disabled={props.busy}>
          <X /> Dismiss
        </Button>
      </div>
    </li>
  );
}

/** AI rule suggestions for the Rules page. Renders nothing while AI is off. */
export function AiRuleSuggestions() {
  const { data: config } = useAiConfig();
  const qc = useQueryClient();
  const invalidateTaxonomy = useInvalidateTaxonomy();
  const { data: categories = [] } = useCategories();
  const [model, setModel] = useState<string>();
  const [applyExisting, setApplyExisting] = useState(true);
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [showDismissed, setShowDismissed] = useState(false);

  const enabled = config?.enabled === true;
  const plan = useQuery({
    queryKey: planKey(model),
    queryFn: () =>
      fetchJson<SuggestPlan>(`/api/ai/rule-suggestions/plan${model ? `?model=${encodeURIComponent(model)}` : ""}`),
    enabled,
  });
  const pending = useQuery({
    queryKey: PENDING_KEY,
    queryFn: async () => (await fetchJson<{ proposals: ProposalView[] }>("/api/ai/proposals")).proposals,
    enabled,
  });
  const dismissed = useQuery({
    queryKey: DISMISSED_KEY,
    queryFn: async () =>
      (await fetchJson<{ proposals: ProposalView[] }>("/api/ai/proposals?status=dismissed")).proposals,
    enabled: enabled && showDismissed,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-proposals"] });
    qc.invalidateQueries({ queryKey: ["ai-rule-plan"] });
    qc.invalidateQueries({ queryKey: ["ai-usage"] });
  };
  const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof ApiError ? e.message : fallback);

  const run = useMutation({
    mutationFn: () =>
      fetchJson<{ created: number; noMatch: number; unanswered: number; tags?: { created?: number } }>(
        "/api/ai/rule-suggestions/run",
        jsonBody("POST", model ? { model } : {}),
      ),
    onSuccess: (r) => {
      const total = r.created + (r.tags?.created ?? 0);
      toast.success(
        total > 0
          ? `${total} new suggestion${total === 1 ? "" : "s"}`
          : r.unanswered > 0
            ? "The model's answer couldn't be read. Nothing was saved; try again."
            : "No new suggestions this time",
      );
      refresh();
    },
    onError: fail("Couldn't get suggestions"),
  });
  const accept = useMutation({
    mutationFn: (p: ProposalView) =>
      fetchJson<{ ruleName: string; categorized: number }>(
        `/api/ai/proposals/${p.id}/accept`,
        jsonBody("POST", { applyExisting, ...(edits[p.id] !== undefined ? { categoryId: edits[p.id] } : {}) }),
      ),
    onSuccess: (r) => {
      toast.success(`Rule "${r.ruleName}" saved${r.categorized ? ` · ${r.categorized} transactions updated` : ""}`);
      invalidateTaxonomy();
      refresh();
    },
    onError: fail("Couldn't accept that suggestion"),
  });
  const acceptAll = useMutation({
    mutationFn: () =>
      fetchJson<{ accepted: number; skipped: number; categorized: number }>(
        "/api/ai/proposals/accept-all",
        jsonBody("POST", { minConfidence: "high", applyExisting }),
      ),
    onSuccess: (r) => {
      toast.success(`Accepted ${r.accepted}${r.skipped ? `, left ${r.skipped} for you to review` : ""}`);
      invalidateTaxonomy();
      refresh();
    },
    onError: fail("Couldn't accept the suggestions"),
  });
  const dismiss = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/ai/proposals/${id}/dismiss`, { method: "POST" }),
    onSuccess: refresh,
    onError: fail("Couldn't dismiss that suggestion"),
  });
  const forget = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/ai/proposals/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail("Couldn't do that"),
  });

  const items = useMemo(() => pending.data ?? [], [pending.data]);
  const groups = useMemo(() => {
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const out = new Map<string, ProposalView[]>();
    for (const p of items) {
      const a = p.payload.action;
      const label = a.type === "tag" ? "Tags" : (names.get(edits[p.id] ?? a.categoryId) ?? a.categoryName);
      out.set(label, [...(out.get(label) ?? []), p]);
    }
    const entries = [...out.entries()];
    return [...entries.filter(([k]) => k !== "Tags"), ...entries.filter(([k]) => k === "Tags")];
  }, [items, categories, edits]);

  if (!enabled) return null;
  const busy = accept.isPending || acceptAll.isPending || dismiss.isPending;
  const sure = items.filter((p) => p.confidence === "high" && (p.preview?.conflicts ?? 0) === 0 && p.stillValid).length;
  const eligible = plan.data?.eligible ?? 0;

  return (
    <Card aria-labelledby="ai-suggestions-title">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ai-suggestions-title" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="size-4" aria-hidden /> AI suggestions
            {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <ModelPicker feature="rules" value={model} onChange={setModel} className="w-44" />
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={() => run.mutate()}
              disabled={run.isPending || eligible === 0}
            >
              {run.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Find suggestions
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground" aria-live="polite">
          {plan.isPending
            ? "Checking which merchants need a rule…"
            : plan.isError
              ? "Couldn't check what's left to categorize."
              : eligible === 0
                ? "Every merchant is covered by a rule."
                : `${eligible} merchant${eligible === 1 ? " has" : "s have"} no rule · ${plan.data!.calls} request${plan.data!.calls === 1 ? "" : "s"} · ≈ ${tokens(plan.data!.estimatedInputTokens)} tokens${plan.data!.estimatedCostMicros !== null ? ` · ≈ ${dollars(plan.data!.estimatedCostMicros)}` : ""}`}
        </p>

        {pending.isPending && <Skeleton className="h-24 w-full rounded-2xl" aria-busy />}
        {pending.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load the suggestions.</span>
            <Button variant="outline" size="sm" onClick={() => pending.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {pending.isSuccess && items.length === 0 && (
          <p className="text-sm text-muted-foreground">No suggestions waiting.</p>
        )}

        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button className="h-11 md:h-9" onClick={() => acceptAll.mutate()} disabled={busy || sure === 0}>
              Accept all high-confidence ({sure})
            </Button>
            <div className="flex items-center gap-2">
              <Checkbox
                id="ai-apply-existing"
                checked={applyExisting}
                onCheckedChange={(v) => setApplyExisting(v === true)}
              />
              <Label htmlFor="ai-apply-existing" className="text-sm font-normal">
                Also categorize existing matches
              </Label>
            </div>
          </div>
        )}

        {groups.map(([label, list]) => (
          <section key={label} aria-label={label} className="space-y-2">
            <h3 className="text-sm font-medium">{label}</h3>
            <ul className="space-y-2">
              {list.map((p) => (
                <Suggestion
                  key={p.id}
                  item={p}
                  categoryId={edits[p.id]}
                  onCategory={(id) => setEdits((e) => ({ ...e, [p.id]: id }))}
                  onAccept={() => accept.mutate(p)}
                  onDismiss={() => dismiss.mutate(p.id)}
                  busy={busy}
                />
              ))}
            </ul>
          </section>
        ))}

        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </Button>
          {showDismissed && (
            <ul className="mt-2 space-y-1 text-sm" aria-label="Dismissed suggestions">
              {dismissed.isPending && <li className="text-muted-foreground">Loading…</li>}
              {dismissed.isError && <li className="text-negative">Couldn&apos;t load these.</li>}
              {dismissed.data?.length === 0 && <li className="text-muted-foreground">Nothing dismissed.</li>}
              {dismissed.data?.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {p.payload.merchant.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      {p.status === "no_match"
                        ? "(no suggestion)"
                        : `(${p.payload.action.type === "category" ? p.payload.action.categoryName : p.payload.action.tagName})`}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 shrink-0 md:h-8"
                    onClick={() => forget.mutate(p.id)}
                    disabled={forget.isPending}
                  >
                    Ask again
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
