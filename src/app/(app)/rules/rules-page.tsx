"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Loader2, MoreHorizontal, Pencil, Play, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { AiRuleSuggestions } from "@/components/rules/ai-suggestions";
import { ApplyDialog, type ApplyTarget } from "@/components/rules/apply-dialog";
import { describeRule, suggestRuleName, type Names } from "@/components/rules/describe";
import { emptyDraft, newCondition, ruleToDraft, type RuleDraft } from "@/components/rules/draft";
import { RuleBuilder, type BuilderTarget } from "@/components/rules/rule-builder";
import { SortableList } from "@/components/sortable-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { useAccountsOverview, useCategories, useTags } from "@/hooks/use-lookups";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import { normalizePayee } from "@/lib/finance/payee";
import type { TransactionDetail } from "@/lib/finance/transaction-types";
import type { Rule } from "@/lib/rules/types";
import { cn } from "@/lib/utils";

const KEY = ["rules"] as const;

export function RulesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const invalidate = useInvalidateTaxonomy();
  const [builder, setBuilder] = useState<BuilderTarget | null>(null);
  const [applying, setApplying] = useState<ApplyTarget | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  const rulesQuery = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ rules: Rule[] }>("/api/rules")).rules,
  });
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { data: groups = [] } = useAccountsOverview();

  const names: Names = useMemo(() => {
    const accounts = new Map(groups.flatMap((g) => g.accounts).map((a) => [a.id, a.label]));
    const cats = new Map(categories.map((c) => [c.id, c.name]));
    const tagNames = new Map(tags.map((t) => [t.id, t.name]));
    return { account: (id) => accounts.get(id), category: (id) => cats.get(id), tag: (id) => tagNames.get(id) };
  }, [groups, categories, tags]);

  // "Create rule from this transaction": /rules?from=<id> opens the builder prefilled from that transaction.
  const fromId = params.get("from");
  useEffect(() => {
    if (!fromId || !/^\d+$/.test(fromId)) return;
    let cancelled = false;
    fetchJson<{ transaction: TransactionDetail }>(`/api/transactions/${fromId}`)
      .then(({ transaction: t }) => {
        if (cancelled) return;
        const merchant = normalizePayee(t.displayPayee);
        const draft: RuleDraft = {
          ...emptyDraft(),
          name: merchant,
          conditions: [{ ...newCondition("payee"), op: "contains", text: merchant }],
          categoryId: t.categoryId,
          tagIds: t.tags.map((x) => x.id),
        };
        setBuilder({ draft });
      })
      .catch(() => toast.error("Couldn't load that transaction"))
      .finally(() => router.replace("/rules"));
    return () => {
      cancelled = true;
    };
  }, [fromId, router]);

  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) =>
      fetchJson(`/api/rules/${v.id}`, jsonBody("PATCH", { enabled: v.enabled })),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Rule[]>(KEY);
      qc.setQueryData<Rule[]>(KEY, (rs) => rs?.map((r) => (r.id === id ? { ...r, enabled } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error("Couldn't change that rule");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => fetchJson("/api/rules/order", jsonBody("PUT", { ids })),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Rule[]>(KEY);
      if (prev)
        qc.setQueryData(
          KEY,
          ids.flatMap((id) => prev.find((r) => r.id === id) ?? []),
        );
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
      toast.error("Couldn't save the new order");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const remove = useMutation({
    mutationFn: (r: Rule) => fetchJson(`/api/rules/${r.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Rule deleted");
      setDeleting(null);
    },
    onError: () => toast.error("Couldn't delete that rule"),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Rules label new transactions for you as they&apos;re imported. They run top to bottom, and the first rule to
            set a category or name wins.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-11 md:h-9"
            disabled={rules.length === 0}
            onClick={() => setApplying({ title: "Apply all rules to existing transactions" })}
          >
            <Play /> Run all
          </Button>
          <Button className="h-11 md:h-9" onClick={() => setBuilder({ draft: emptyDraft() })}>
            <Plus /> New rule
          </Button>
        </div>
      </div>

      <AiRuleSuggestions />

      {rulesQuery.isPending ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : rulesQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load your rules.</span>
          <Button variant="outline" size="sm" onClick={() => rulesQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No rules yet. Create one to categorize a merchant automatically, or start from any transaction with “Create rule from this…”."
          action={
            <Button variant="outline" size="sm" onClick={() => setBuilder({ draft: emptyDraft() })}>
              <Plus /> New rule
            </Button>
          }
        />
      ) : (
        <SortableList
          items={rules}
          getLabel={(r) => r.name || suggestRuleName(r, names)}
          onReorder={(ids) => reorder.mutate(ids)}
          renderItem={(r, { handle }) => {
            const d = describeRule(r, names);
            const title = r.name || suggestRuleName(r, names);
            return (
              <Card data-testid="rule-row" className={cn("py-3", !r.enabled && "opacity-60")}>
                <CardContent className="flex items-start gap-2 px-3">
                  {handle}
                  <div className="min-w-0 flex-1 space-y-1 pt-1">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">If</span> {d.when}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Then</span> {d.then}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(enabled) => toggle.mutate({ id: r.id, enabled })}
                      aria-label={`${r.enabled ? "Disable" : "Enable"} rule ${title}`}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 md:size-9"
                          aria-label={`Actions for ${title}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setBuilder({ id: r.id, draft: ruleToDraft(r) })}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setApplying({ ruleId: r.id, title: `Apply “${title}” to existing transactions` })
                          }
                        >
                          <ListChecks /> Apply to existing…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(r)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          }}
        />
      )}

      <RuleBuilder target={builder} onClose={() => setBuilder(null)} />
      <ApplyDialog target={applying} onClose={() => setApplying(null)} />

      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this rule?"
        description="Transactions it already changed keep their categories and tags."
      >
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-11 md:h-9"
            disabled={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting)}
          >
            {remove.isPending && <Loader2 className="animate-spin" />} Delete
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
