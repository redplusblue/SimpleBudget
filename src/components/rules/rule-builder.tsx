"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { TagPicker } from "@/components/register/tag-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { useAccountsOverview, useCategories, useTags } from "@/hooks/use-lookups";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import { ConditionEditor } from "./condition-editor";
import { draftToInput, type RuleDraft } from "./draft";
import { RulePreview } from "./rule-preview";

const NO_CATEGORY = "none";

export interface BuilderTarget {
  /** Set when editing an existing rule. */
  id?: number;
  draft: RuleDraft;
}

export function RuleBuilder({ target, onClose }: { target: BuilderTarget | null; onClose: () => void }) {
  return (
    <ResponsiveDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={target?.id ? "Edit rule" : "New rule"}
      description="Rules run on new transactions as they're imported, in the order shown on the Rules page."
      className="sm:max-w-2xl"
    >
      {target && <BuilderForm key={target.id ?? "new"} target={target} onClose={onClose} />}
    </ResponsiveDialog>
  );
}

function BuilderForm({ target, onClose }: { target: BuilderTarget; onClose: () => void }) {
  const [draft, setDraft] = useState<RuleDraft>(target.draft);
  const [overwrite, setOverwrite] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const invalidate = useInvalidateTaxonomy();
  const { data: categories = [] } = useCategories();
  const { data: tags = [] } = useTags();
  const { data: groups = [] } = useAccountsOverview();
  const accounts = useMemo(() => groups.flatMap((g) => g.accounts), [groups]);

  const result = useMemo(() => draftToInput(draft), [draft]);
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    mutationFn: () => {
      if (!result.ok) throw new Error(result.error);
      return target.id === undefined
        ? fetchJson("/api/rules", jsonBody("POST", result.input))
        : fetchJson(`/api/rules/${target.id}`, jsonBody("PUT", result.input));
    },
    onSuccess: () => {
      invalidate();
      toast.success(target.id === undefined ? "Rule created" : "Rule saved");
      onClose();
    },
    onError: (e) => setServerError(e instanceof Error ? e.message : "Couldn't save the rule"),
  });

  const activeCategories = categories.filter((c) => !c.isArchived || c.id === draft.categoryId);
  const tagById = new Map(tags.map((t) => [t.id, t]));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        save.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="rule-name">Name (optional)</Label>
        <Input
          id="rule-name"
          value={draft.name}
          maxLength={120}
          placeholder="e.g. Trader Joe's → Groceries"
          onChange={(e) => set({ name: e.target.value })}
          className="h-11 md:h-9"
        />
      </div>

      <ConditionEditor
        match={draft.match}
        conditions={draft.conditions}
        accounts={accounts}
        onChange={(patch) => set(patch)}
      />

      <section aria-label="Actions" className="space-y-3">
        <p className="text-sm font-medium">Then:</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Set category</Label>
            <Select
              value={draft.categoryId === null ? NO_CATEGORY : String(draft.categoryId)}
              onValueChange={(v) => set({ categoryId: v === NO_CATEGORY ? null : Number(v) })}
            >
              <SelectTrigger aria-label="Set category" className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Don&apos;t change</SelectItem>
                {activeCategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                    {c.isArchived ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-payee">Rename payee to</Label>
            <Input
              id="rule-payee"
              value={draft.payeeOverride}
              maxLength={200}
              placeholder="Don't change"
              onChange={(e) => set({ payeeOverride: e.target.value })}
              className="h-11 md:h-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Add tags</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.tagIds.map((id) => {
              const t = tagById.get(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-2.5 text-xs"
                >
                  <span aria-hidden className="size-1.5 rounded-full" style={{ background: t?.color ?? "#6B7385" }} />
                  {t?.name ?? "Removed tag"}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t?.name ?? id}`}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground"
                    onClick={() => set({ tagIds: draft.tagIds.filter((x) => x !== id) })}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            <TagPicker
              selectedIds={draft.tagIds}
              onPick={(tag) =>
                set({
                  tagIds: draft.tagIds.includes(tag.id)
                    ? draft.tagIds.filter((x) => x !== tag.id)
                    : [...draft.tagIds, tag.id],
                })
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                aria-label="Add tag"
              >
                <Plus className="size-3" /> {draft.tagIds.length ? "" : "Add tag"}
              </Button>
            </TagPicker>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <SwitchRow
            id="rule-transfer"
            label="Mark as a transfer"
            description="Not counted as spending or income."
            checked={draft.markTransfer}
            onChange={(v) => set({ markTransfer: v })}
          />
          <SwitchRow
            id="rule-exclude"
            label="Exclude from stats"
            description="Hide from spending totals."
            checked={draft.exclude}
            onChange={(v) => set({ exclude: v })}
          />
        </div>
      </section>

      <RulePreview
        input={result.ok ? result.input : null}
        incompleteReason={result.ok ? undefined : result.error}
        overwrite={overwrite}
        onOverwriteChange={setOverwrite}
      />

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
        <Label htmlFor="rule-enabled" className="flex-col items-start gap-0.5 text-sm font-medium">
          Enabled
          <span className="text-xs font-normal text-muted-foreground">Disabled rules are kept but don&apos;t run.</span>
        </Label>
        <Switch id="rule-enabled" checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-negative">
          {serverError}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 md:h-9" disabled={!result.ok || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}{" "}
          {target.id === undefined ? "Create rule" : "Save rule"}
        </Button>
      </div>
    </form>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="flex-col items-start gap-0.5 text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
