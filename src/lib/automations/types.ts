import { z } from "zod";
import { LENS_IDS } from "@/lib/ai/lenses";
import { conditionSchema, MAX_CONDITIONS } from "@/lib/rules/types";

// Client-safe: shared by the automations API, the editor and the scheduler.

export const MAX_AUTOMATIONS = 30;

// ── triggers ────────────────────────────────────────────────────────────────

export const scheduleTrigger = z
  .object({
    type: z.literal("schedule"),
    every: z.enum(["day", "week", "month"]),
    hour: z.number().int().min(0).max(23),
    minute: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]),
    /** 0 = Sunday. Required for weekly schedules. */
    weekday: z.number().int().min(0).max(6).optional(),
    /** Limited to 1-28 so every month has it. Required for monthly schedules. */
    monthDay: z.number().int().min(1).max(28).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.every === "week" && t.weekday === undefined)
      ctx.addIssue({ code: "custom", message: "Choose a day of the week", path: ["weekday"] });
    if (t.every === "month" && t.monthDay === undefined)
      ctx.addIssue({ code: "custom", message: "Choose a day of the month (1-28)", path: ["monthDay"] });
  });

export const transactionTrigger = z.object({
  type: z.literal("transaction"),
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1, "Add at least one condition").max(MAX_CONDITIONS),
  includePending: z.boolean().default(false),
});

export const targetTrigger = z.object({ type: z.literal("target_exceeded") });

export const balanceTrigger = z.object({
  type: z.literal("balance_below"),
  accountId: z.string().min(1, "Choose an account").max(200),
  cents: z.number().int().min(0).max(100_000_000_00),
});

export const triggerSchema = z.discriminatedUnion("type", [
  scheduleTrigger,
  transactionTrigger,
  targetTrigger,
  balanceTrigger,
]);

// ── actions ─────────────────────────────────────────────────────────────────

const lens = z.enum([...LENS_IDS, "all"]);

export const messageAction = z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(500) });
export const factAction = z.object({ type: z.literal("fact"), lens, pick: z.enum(["top", "random"]) });
export const aiInsightAction = z.object({
  type: z.literal("ai_insight"),
  lens,
  count: z.number().int().min(1).max(3),
});
export const aiPromptAction = z.object({
  type: z.literal("ai_prompt"),
  lens: z.enum(LENS_IDS),
  prompt: z.string().trim().min(1).max(1000),
});

export const actionSchema = z.discriminatedUnion("type", [messageAction, factAction, aiInsightAction, aiPromptAction]);

export type Trigger = z.infer<typeof triggerSchema>;
export type ScheduleTrigger = z.infer<typeof scheduleTrigger>;
export type Action = z.infer<typeof actionSchema>;

export const isAiAction = (a: Action) => a.type === "ai_insight" || a.type === "ai_prompt";

export const automationInputSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(80),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  action: actionSchema,
  destinationId: z.number().int().positive("Choose where to send it"),
  /** For AI actions; defaults to the "automations" model. Ignored (stored as null) for other actions. */
  model: z.string().trim().min(1).max(120).nullish(),
  includeDetails: z.boolean().default(false),
});
export type AutomationInput = z.input<typeof automationInputSchema>;

export interface AutomationView {
  id: number;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  action: Action;
  destinationId: number;
  model: string | null;
  includeDetails: boolean;
  lastRunAt: number | null;
  lastStatus: string | null;
  createdAt: number;
}

export interface AutomationRunView {
  id: number;
  startedAt: number;
  status: "sent" | "skipped" | "error";
  reason: string | null;
  preview: string | null;
}

/** A fixed cron expression from the preset schedule: there are no free-form cron strings. */
export function scheduleToCron(t: ScheduleTrigger): string {
  if (t.every === "day") return `${t.minute} ${t.hour} * * *`;
  if (t.every === "week") return `${t.minute} ${t.hour} * * ${t.weekday}`;
  return `${t.minute} ${t.hour} ${t.monthDay} * *`;
}

// ── templates ───────────────────────────────────────────────────────────────

export const TEMPLATE_VARIABLES = [
  "payee",
  "amount",
  "date",
  "category",
  "account",
  "month_spent",
  "month_income",
  "today",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** Which variables a trigger can fill (the transaction ones only make sense for a transaction trigger). */
export const TRANSACTION_VARIABLES: TemplateVariable[] = ["payee", "amount", "date", "category", "account"];

/**
 * Replaces `{name}` for names in the fixed allow-list. Anything else (including `{{payee}}`, `{constructor}`) is left
 * as literal text; there are no expressions.
 */
export function renderTemplate(text: string, vars: Partial<Record<TemplateVariable, string>>): string {
  return text.replace(/(?<!\{)\{([a-z_]+)\}(?!\})/g, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return whole;
    const value = vars[name as TemplateVariable];
    return value === undefined ? whole : value;
  });
}
