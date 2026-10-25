import { z } from "zod";

// Client-safe.

export const MAX_GOAL_CENTS = 100_000_000_00;

export const goalInputSchema = z
  .object({
    name: z.string().trim().min(1, "Give the goal a name").max(80),
    accountId: z.string().min(1, "Choose an account").max(200),
    targetCents: z.number().int().min(1, "Enter a target above zero").max(MAX_GOAL_CENTS),
    /** What the account already held that shouldn't count toward the goal. */
    startCents: z.number().int().min(0).max(MAX_GOAL_CENTS).default(0),
    targetDate: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-06-30")])
      .nullish()
      .transform((d) => d || null),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullish()
      .transform((c) => c ?? null),
  })
  .refine((g) => g.startCents < g.targetCents, {
    message: "The starting amount must be below the target",
    path: ["startCents"],
  });

export type GoalInput = z.input<typeof goalInputSchema>;

export type GoalStatus = "done" | "on_track" | "behind" | "no_date";

export interface GoalProgress {
  id: number;
  name: string;
  accountId: string;
  accountName: string;
  currency: string;
  color: string | null;
  targetCents: number;
  startCents: number;
  targetDate: string | null;
  /** The account's balance right now. */
  balanceCents: number;
  /** Progress so far: balance above the starting amount, never negative. */
  savedCents: number;
  remainingCents: number;
  /** 0 to 1 (1 once reached). */
  fraction: number;
  status: GoalStatus;
  /** Months until the target date (0 when past), or null without a date. */
  monthsLeft: number | null;
  /** What would have to be saved each month to finish by the target date. */
  neededPerMonthCents: number | null;
  /** How fast the account balance has been growing over the last 90 days, per month. */
  recentPerMonthCents: number | null;
  /** When the goal is reached at the recent pace (`YYYY-MM-DD`), or null if not growing or already done. */
  projectedDate: string | null;
}
