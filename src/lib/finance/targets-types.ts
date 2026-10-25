import { z } from "zod";

// Client-safe: shared by the targets API, the settings forms and the progress bars.

export type TargetKind = "category" | "tag";

/** Bars turn amber from here, and red once spending passes 100%. */
export const WARNING_AT = 0.8;
/** Projections need a few days of data to mean anything. */
export const MIN_DAYS_FOR_PROJECTION = 3;
export const MAX_TARGET_CENTS = 100_000_000_00;

export const targetInputSchema = z.object({
  kind: z.enum(["category", "tag"]),
  subjectId: z.number().int().positive(),
  amountCents: z.number().int().min(1, "Enter an amount above zero").max(MAX_TARGET_CENTS, "That amount is too large"),
  /** `YYYY-MM` for a one-month target, or null/omitted for every month. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10")
    .nullish()
    .transform((m) => m ?? null),
});

export const targetPatchSchema = z
  .object({ amountCents: targetInputSchema.shape.amountCents, month: targetInputSchema.shape.month })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export type TargetInput = z.input<typeof targetInputSchema>;
export type TargetPatch = z.input<typeof targetPatchSchema>;

export interface TargetRow {
  id: number;
  kind: TargetKind;
  subjectId: number;
  subjectName: string;
  subjectColor: string;
  subjectIcon: string | null;
  amountCents: number;
  /** `YYYY-MM`, or null for a recurring target. */
  month: string | null;
}

export type TargetStatus = "ok" | "warning" | "over";

export interface TargetProgress {
  id: number;
  kind: TargetKind;
  subjectId: number;
  name: string;
  color: string;
  icon: string | null;
  amountCents: number;
  spentCents: number;
  /** Negative once over the target. */
  remainingCents: number;
  /** spent / amount (can exceed 1). */
  fraction: number;
  status: TargetStatus;
  scope: "recurring" | "month";
  /** Month-end spending at the current pace; only for the current month, after a few days. */
  projectedCents: number | null;
  /** Under target now but on pace to pass it. */
  onPaceToExceed: boolean;
}

export const targetStatus = (fraction: number): TargetStatus =>
  fraction > 1 ? "over" : fraction >= WARNING_AT ? "warning" : "ok";
