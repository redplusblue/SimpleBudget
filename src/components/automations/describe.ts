import { LENSES } from "@/lib/ai/lenses";
import { formatCents } from "@/lib/finance/cents";
import type { Action, AutomationView, Trigger } from "@/lib/automations/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

export function describeTrigger(t: Trigger, accountLabel?: string): string {
  switch (t.type) {
    case "schedule": {
      const at = `${pad(t.hour)}:${pad(t.minute)}`;
      if (t.every === "day") return `Every day at ${at}`;
      if (t.every === "week") return `Every ${WEEKDAYS[t.weekday ?? 0]} at ${at}`;
      return `On day ${t.monthDay} of each month at ${at}`;
    }
    case "transaction":
      return "When a matching transaction arrives";
    case "target_exceeded":
      return "When a category goes over its target";
    case "balance_below":
      return `When ${accountLabel ?? "an account"} falls below ${formatCents(t.cents)}`;
  }
}

const lensLabel = (l: string) => (l === "all" ? "everything" : LENSES[l as keyof typeof LENSES].label);

export function describeAction(a: Action): string {
  switch (a.type) {
    case "message":
      return "message";
    case "fact":
      return `fact (${lensLabel(a.lens)}, ${a.pick})`;
    case "ai_insight":
      return `AI insight (${lensLabel(a.lens)})`;
    case "ai_prompt":
      return `AI prompt (${lensLabel(a.lens)})`;
  }
}

/** "Every Sunday at 09:00 → AI insight (Spending) → Discord · Smart model" */
export function describeAutomation(
  a: AutomationView,
  names: { destination?: string; model?: string; account?: string },
): string {
  return [
    describeTrigger(a.trigger, names.account),
    describeAction(a.action),
    `${names.destination ?? "a destination"}${a.model ? ` · ${names.model ?? a.model}` : ""}`,
  ].join(" → ");
}
