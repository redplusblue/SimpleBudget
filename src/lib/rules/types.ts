import { z } from "zod";

// Client-safe: shared by the rules API, the builder UI and the engine.

export const TEXT_FIELDS = ["description", "payee"] as const;
export const TEXT_OPS = ["contains", "equals", "regex"] as const;
export const AMOUNT_OPS = ["gt", "lt", "equals", "between"] as const;
export const DIRECTIONS = ["expense", "income"] as const;

export const MAX_REGEX_LENGTH = 200;
export const MAX_CONDITIONS = 12;

const cents = z.number().int().min(0).max(1_000_000_000_00);

const textCondition = z.object({
  field: z.enum(TEXT_FIELDS),
  op: z.enum(TEXT_OPS),
  value: z.string().trim().min(1, "Enter a value").max(300),
});

const amountCondition = z.union([
  z.object({ field: z.literal("amount"), op: z.enum(["gt", "lt", "equals"]), value: cents }),
  z.object({
    field: z.literal("amount"),
    op: z.literal("between"),
    value: z.object({ min: cents, max: cents }).refine((v) => v.min <= v.max, "Minimum must not exceed maximum"),
  }),
]);

const accountCondition = z.object({
  field: z.literal("account"),
  op: z.literal("equals"),
  value: z.string().min(1).max(200),
});
const directionCondition = z.object({
  field: z.literal("direction"),
  op: z.literal("equals"),
  value: z.enum(DIRECTIONS),
});

export const conditionSchema = z
  .union([textCondition, amountCondition, accountCondition, directionCondition])
  .superRefine((c, ctx) => {
    if ((c.field === "description" || c.field === "payee") && c.op === "regex") {
      if (c.value.length > MAX_REGEX_LENGTH)
        ctx.addIssue({ code: "custom", message: `Patterns are limited to ${MAX_REGEX_LENGTH} characters` });
      try {
        new RegExp(c.value, "i");
      } catch {
        ctx.addIssue({ code: "custom", message: "That regular expression isn't valid" });
      }
    }
  });

export const actionsSchema = z
  .object({
    categoryId: z.number().int().positive().optional(),
    addTagIds: z.array(z.number().int().positive()).max(20).optional(),
    payeeOverride: z.string().trim().min(1).max(200).optional(),
    markTransfer: z.boolean().optional(),
    exclude: z.boolean().optional(),
  })
  .strict()
  .refine(
    (a) =>
      a.categoryId !== undefined ||
      (a.addTagIds?.length ?? 0) > 0 ||
      a.payeeOverride !== undefined ||
      a.markTransfer === true ||
      a.exclude === true,
    "Choose at least one action",
  );

export const ruleInputSchema = z.object({
  name: z.string().trim().max(120).default(""),
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).min(1, "Add at least one condition").max(MAX_CONDITIONS),
  actions: actionsSchema,
  enabled: z.boolean().default(true),
});

export type Condition = z.infer<typeof conditionSchema>;
export type RuleActions = z.infer<typeof actionsSchema>;
export type RuleInput = z.input<typeof ruleInputSchema>;
export type RuleDefinition = z.output<typeof ruleInputSchema>;

export interface Rule extends RuleDefinition {
  id: number;
  priority: number;
}

export type ConditionField = Condition["field"];

export const FIELD_LABELS: Record<ConditionField, string> = {
  description: "Description",
  payee: "Payee",
  amount: "Amount",
  account: "Account",
  direction: "Direction",
};

export const OP_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "is",
  regex: "matches regex",
  gt: "is more than",
  lt: "is less than",
  between: "is between",
};

export const OPS_FOR_FIELD: Record<ConditionField, readonly string[]> = {
  description: TEXT_OPS,
  payee: TEXT_OPS,
  amount: AMOUNT_OPS,
  account: ["equals"],
  direction: ["equals"],
};
