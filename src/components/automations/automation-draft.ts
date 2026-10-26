import {
  conditionsFromDrafts,
  draftsFromConditions,
  newCondition,
  type ConditionDraft,
} from "@/components/rules/draft";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { LensId } from "@/lib/ai/lenses";
import {
  automationInputSchema,
  type AutomationInput,
  type AutomationView,
  type ScheduleTrigger,
} from "@/lib/automations/types";

/** The editor works with strings and flat fields; these helpers convert to and from the stored shape. */

export type TriggerType = "schedule" | "transaction" | "target_exceeded" | "balance_below";
export type ActionType = "message" | "fact" | "ai_insight" | "ai_prompt";

export interface AutomationDraft {
  name: string;
  enabled: boolean;
  triggerType: TriggerType;
  every: ScheduleTrigger["every"];
  hour: number;
  minute: 0 | 15 | 30 | 45;
  weekday: number;
  monthDay: number;
  match: "all" | "any";
  conditions: ConditionDraft[];
  includePending: boolean;
  accountId: string;
  /** Dollars, as typed. */
  balanceDollars: string;
  actionType: ActionType;
  text: string;
  lens: LensId | "all";
  pick: "top" | "random";
  count: number;
  prompt: string;
  /** Undefined means "the default for automations". */
  model: string | undefined;
  destinationId: number | null;
  includeDetails: boolean;
}

export const emptyAutomationDraft = (): AutomationDraft => ({
  name: "",
  enabled: true,
  triggerType: "schedule",
  every: "week",
  hour: 9,
  minute: 0,
  weekday: 0,
  monthDay: 1,
  match: "all",
  conditions: [{ ...newCondition("amount"), op: "gt" }],
  includePending: false,
  accountId: "",
  balanceDollars: "",
  actionType: "message",
  text: "",
  lens: "spending",
  pick: "top",
  count: 2,
  prompt: "",
  model: undefined,
  destinationId: null,
  includeDetails: false,
});

/** The example offered on the empty state: every Sunday, a spending insight. */
export const exampleDraft = (destinationId: number | null): AutomationDraft => ({
  ...emptyAutomationDraft(),
  name: "Weekly spending insight",
  actionType: "ai_insight",
  lens: "spending",
  count: 2,
  destinationId,
});

export type DraftResult = { ok: true; input: AutomationInput } | { ok: false; error: string };

export function draftToAutomationInput(d: AutomationDraft): DraftResult {
  let trigger: unknown;
  if (d.triggerType === "schedule") {
    trigger = {
      type: "schedule",
      every: d.every,
      hour: d.hour,
      minute: d.minute,
      ...(d.every === "week" ? { weekday: d.weekday } : {}),
      ...(d.every === "month" ? { monthDay: d.monthDay } : {}),
    };
  } else if (d.triggerType === "transaction") {
    const built = conditionsFromDrafts(d.conditions);
    if (!built.ok) return built;
    trigger = { type: "transaction", match: d.match, conditions: built.conditions, includePending: d.includePending };
  } else if (d.triggerType === "balance_below") {
    if (!d.accountId) return { ok: false, error: "Choose an account" };
    let cents: number;
    try {
      cents = Math.abs(parseCents(d.balanceDollars.trim().replace(/^\$/, "")));
    } catch {
      return { ok: false, error: "Amounts should look like 25.00" };
    }
    if (!d.balanceDollars.trim()) return { ok: false, error: "Enter an amount" };
    trigger = { type: "balance_below", accountId: d.accountId, cents };
  } else {
    trigger = { type: "target_exceeded" };
  }

  const action =
    d.actionType === "message"
      ? { type: "message", text: d.text }
      : d.actionType === "fact"
        ? { type: "fact", lens: d.lens, pick: d.pick }
        : d.actionType === "ai_insight"
          ? { type: "ai_insight", lens: d.lens, count: d.count }
          : { type: "ai_prompt", lens: d.lens === "all" ? "general" : d.lens, prompt: d.prompt };

  if (d.destinationId === null) return { ok: false, error: "Choose where to send it" };
  const parsed = automationInputSchema.safeParse({
    name: d.name,
    enabled: d.enabled,
    trigger,
    action,
    destinationId: d.destinationId,
    model: d.actionType === "ai_insight" || d.actionType === "ai_prompt" ? (d.model ?? null) : null,
    includeDetails: d.includeDetails,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "This isn't complete yet" };
  return { ok: true, input: parsed.data };
}

export function automationToDraft(a: AutomationView): AutomationDraft {
  const d: AutomationDraft = {
    ...emptyAutomationDraft(),
    name: a.name,
    enabled: a.enabled,
    destinationId: a.destinationId,
    includeDetails: a.includeDetails,
    model: a.model ?? undefined,
    triggerType: a.trigger.type,
    actionType: a.action.type,
  };
  const t = a.trigger;
  if (t.type === "schedule")
    Object.assign(d, {
      every: t.every,
      hour: t.hour,
      minute: t.minute,
      weekday: t.weekday ?? 0,
      monthDay: t.monthDay ?? 1,
    });
  if (t.type === "transaction")
    Object.assign(d, {
      match: t.match,
      conditions: draftsFromConditions(t.conditions),
      includePending: t.includePending,
    });
  if (t.type === "balance_below")
    Object.assign(d, { accountId: t.accountId, balanceDollars: centsToDecimalString(t.cents) });
  const x = a.action;
  if (x.type === "message") d.text = x.text;
  if (x.type === "fact") Object.assign(d, { lens: x.lens, pick: x.pick });
  if (x.type === "ai_insight") Object.assign(d, { lens: x.lens, count: x.count });
  if (x.type === "ai_prompt") Object.assign(d, { lens: x.lens, prompt: x.prompt });
  return d;
}
