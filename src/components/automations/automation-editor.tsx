"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ModelPicker } from "@/components/ai/model-picker";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { ConditionEditor } from "@/components/rules/condition-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAccountsOverview } from "@/hooks/use-lookups";
import { LENSES, LENS_IDS } from "@/lib/ai/lenses";
import { TEMPLATE_VARIABLES, TRANSACTION_VARIABLES, type TemplateVariable } from "@/lib/automations/types";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { draftToAutomationInput, type ActionType, type AutomationDraft, type TriggerType } from "./automation-draft";
import { useDestinations } from "./destinations-card";

export const AUTOMATIONS_KEY = ["automations"] as const;

export interface EditorTarget {
  /** Set when editing an existing automation. */
  id?: number;
  draft: AutomationDraft;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

export function AutomationEditor({ target, onClose }: { target: EditorTarget | null; onClose: () => void }) {
  return (
    <ResponsiveDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={target?.id ? "Edit automation" : "New automation"}
      description="When something happens, do something, and send it somewhere."
      className="sm:max-w-2xl"
    >
      {target && <EditorForm key={target.id ?? "new"} target={target} onClose={onClose} />}
    </ResponsiveDialog>
  );
}

function variablesFor(t: TriggerType): TemplateVariable[] {
  const common: TemplateVariable[] = ["month_spent", "month_income", "today"];
  if (t === "transaction") return [...TRANSACTION_VARIABLES, ...common];
  if (t === "target_exceeded") return ["category", ...common];
  if (t === "balance_below") return ["account", ...common];
  return common;
}

function EditorForm({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<AutomationDraft>(target.draft);
  const [serverError, setServerError] = useState<string | null>(null);
  const { data: destinations = [] } = useDestinations();
  const { data: groups = [] } = useAccountsOverview();
  const accounts = useMemo(() => groups.flatMap((g) => g.accounts), [groups]);
  const set = (patch: Partial<AutomationDraft>) => setD((x) => ({ ...x, ...patch }));
  const result = useMemo(() => draftToAutomationInput(d), [d]);
  const isAi = d.actionType === "ai_insight" || d.actionType === "ai_prompt";

  const save = useMutation({
    mutationFn: () => {
      if (!result.ok) throw new Error(result.error);
      return target.id === undefined
        ? fetchJson("/api/automations", jsonBody("POST", result.input))
        : fetchJson(`/api/automations/${target.id}`, jsonBody("PATCH", result.input));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
      toast.success(target.id === undefined ? "Automation created" : "Automation saved");
      onClose();
    },
    onError: (e) => setServerError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save"),
  });

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
        <Label htmlFor="auto-name">Name</Label>
        <Input
          id="auto-name"
          value={d.name}
          maxLength={80}
          onChange={(e) => set({ name: e.target.value })}
          className="h-11 md:h-9"
        />
      </div>

      <section aria-label="When" className="space-y-3">
        <p className="text-sm font-medium">When</p>
        <Select value={d.triggerType} onValueChange={(v) => set({ triggerType: v as TriggerType })}>
          <SelectTrigger aria-label="Trigger" className="h-11 w-full md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="schedule">On a schedule</SelectItem>
            <SelectItem value="transaction">A matching transaction arrives</SelectItem>
            <SelectItem value="target_exceeded">A category goes over its target</SelectItem>
            <SelectItem value="balance_below">An account balance falls below an amount</SelectItem>
          </SelectContent>
        </Select>

        {d.triggerType === "schedule" && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Select value={d.every} onValueChange={(v) => set({ every: v as AutomationDraft["every"] })}>
              <SelectTrigger aria-label="Repeat" className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Every day</SelectItem>
                <SelectItem value="week">Every week</SelectItem>
                <SelectItem value="month">Every month</SelectItem>
              </SelectContent>
            </Select>
            {d.every === "week" && (
              <Select value={String(d.weekday)} onValueChange={(v) => set({ weekday: Number(v) })}>
                <SelectTrigger aria-label="Day of the week" className="h-11 w-full md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((w, i) => (
                    <SelectItem key={w} value={String(i)}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {d.every === "month" && (
              <Select value={String(d.monthDay)} onValueChange={(v) => set({ monthDay: Number(v) })}>
                <SelectTrigger aria-label="Day of the month" className="h-11 w-full md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Day {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={String(d.hour)} onValueChange={(v) => set({ hour: Number(v) })}>
              <SelectTrigger aria-label="Hour" className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {pad(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(d.minute)}
              onValueChange={(v) => set({ minute: Number(v) as AutomationDraft["minute"] })}
            >
              <SelectTrigger aria-label="Minute" className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 15, 30, 45].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    :{pad(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {d.triggerType === "transaction" && (
          <>
            <ConditionEditor
              match={d.match}
              conditions={d.conditions}
              accounts={accounts}
              onChange={(patch) => set(patch)}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-pending"
                checked={d.includePending}
                onCheckedChange={(v) => set({ includePending: v === true })}
              />
              <Label htmlFor="auto-pending" className="text-sm font-normal">
                Include pending transactions
              </Label>
            </div>
          </>
        )}

        {d.triggerType === "target_exceeded" && (
          <p className="text-sm text-muted-foreground">
            Sends once per category each month, after a sync finds it over its target.
          </p>
        )}

        {d.triggerType === "balance_below" && (
          <div className="grid gap-2 md:grid-cols-2">
            <Select value={d.accountId} onValueChange={(v) => set({ accountId: v })}>
              <SelectTrigger aria-label="Account" className="h-11 w-full md:h-9">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Below amount in dollars"
              inputMode="decimal"
              placeholder="Below $"
              value={d.balanceDollars}
              onChange={(e) => set({ balanceDollars: e.target.value })}
              className="h-11 md:h-9"
            />
          </div>
        )}
      </section>

      <section aria-label="Do" className="space-y-3">
        <p className="text-sm font-medium">Do</p>
        <Select value={d.actionType} onValueChange={(v) => set({ actionType: v as ActionType })}>
          <SelectTrigger aria-label="Action" className="h-11 w-full md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="message">Send a message</SelectItem>
            <SelectItem value="fact">Send a computed fact (free)</SelectItem>
            <SelectItem value="ai_insight">Send an AI insight</SelectItem>
            <SelectItem value="ai_prompt">Ask the AI something and send the answer</SelectItem>
          </SelectContent>
        </Select>

        {d.actionType === "message" && (
          <div className="space-y-2">
            <Textarea
              aria-label="Message"
              rows={3}
              maxLength={500}
              value={d.text}
              placeholder="e.g. {payee} charged {amount}"
              onChange={(e) => set({ text: e.target.value })}
            />
            <div className="flex flex-wrap gap-1.5" aria-label="Variables you can use">
              {variablesFor(d.triggerType)
                .filter((v) => (TEMPLATE_VARIABLES as readonly string[]).includes(v))
                .map((v) => (
                  <Button
                    key={v}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 rounded-full px-3 text-xs md:h-7"
                    onClick={() => set({ text: `${d.text}${d.text && !d.text.endsWith(" ") ? " " : ""}{${v}}` })}
                  >
                    {`{${v}}`}
                  </Button>
                ))}
            </div>
          </div>
        )}

        {(d.actionType === "fact" || d.actionType === "ai_insight" || d.actionType === "ai_prompt") && (
          <div className="grid gap-2 md:grid-cols-2">
            <Select value={d.lens} onValueChange={(v) => set({ lens: v as AutomationDraft["lens"] })}>
              <SelectTrigger aria-label="Focus" className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {d.actionType !== "ai_prompt" && <SelectItem value="all">Everything</SelectItem>}
                {LENS_IDS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LENSES[l].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {d.actionType === "fact" && (
              <Select value={d.pick} onValueChange={(v) => set({ pick: v as "top" | "random" })}>
                <SelectTrigger aria-label="Which fact" className="h-11 w-full md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">The most important</SelectItem>
                  <SelectItem value="random">A random one</SelectItem>
                </SelectContent>
              </Select>
            )}
            {d.actionType === "ai_insight" && (
              <Select value={String(d.count)} onValueChange={(v) => set({ count: Number(v) })}>
                <SelectTrigger aria-label="How many cards" className="h-11 w-full md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} card{n === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {d.actionType === "ai_prompt" && (
          <Textarea
            aria-label="Prompt"
            rows={3}
            maxLength={1000}
            value={d.prompt}
            placeholder="e.g. How did my week of spending look?"
            onChange={(e) => set({ prompt: e.target.value })}
          />
        )}

        {isAi && (
          <div className="space-y-2">
            <ModelPicker
              feature="automations"
              value={d.model}
              onChange={(m) => set({ model: m })}
              className="w-full md:w-64"
            />
            <p className="text-xs text-muted-foreground">
              Uses AI each time it runs. Counts toward your monthly budget.
            </p>
          </div>
        )}
      </section>

      <section aria-label="Send to" className="space-y-3">
        <p className="text-sm font-medium">Send to</p>
        {destinations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a destination first (above the list of automations).</p>
        ) : (
          <Select
            value={d.destinationId === null ? "" : String(d.destinationId)}
            onValueChange={(v) => set({ destinationId: Number(v) })}
          >
            <SelectTrigger aria-label="Destination" className="h-11 w-full md:h-9">
              <SelectValue placeholder="Choose a destination" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((x) => (
                <SelectItem key={x.id} value={String(x.id)}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-start gap-3">
          <Checkbox
            id="auto-details"
            checked={d.includeDetails}
            onCheckedChange={(v) => set({ includeDetails: v === true })}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor="auto-details">Include payee and account names</Label>
            <p className="text-xs text-muted-foreground">
              Off: messages say &ldquo;a merchant&rdquo; and &ldquo;an account&rdquo;.
            </p>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
        <Label htmlFor="auto-enabled">Enabled</Label>
        <Switch id="auto-enabled" checked={d.enabled} onCheckedChange={(v) => set({ enabled: v })} />
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
          {save.isPending && <Loader2 className="animate-spin" />} {target.id === undefined ? "Create" : "Save"}
        </Button>
      </div>
    </form>
  );
}
