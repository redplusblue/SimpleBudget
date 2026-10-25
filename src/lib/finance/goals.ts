import { eq } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, goals } from "@/db/schema";
import { balanceSeries } from "./accounts-overview";
import { addDaysToDate, localDateString } from "./dates";
import { goalInputSchema, type GoalInput, type GoalProgress, type GoalStatus } from "./goals-types";

export class GoalError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const PACE_DAYS = 90;
const DAYS_PER_MONTH = 30.4375;

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

function assertAccount(db: DbLike, id: string) {
  if (!db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get())
    throw new GoalError("invalid", "That account no longer exists");
}

export function createGoal(db: DbLike, input: GoalInput): number {
  const v = goalInputSchema.parse(input);
  assertAccount(db, v.accountId);
  return db.insert(goals).values(v).returning({ id: goals.id }).get().id;
}

export function updateGoal(db: DbLike, id: number, input: GoalInput): void {
  const v = goalInputSchema.parse(input);
  assertAccount(db, v.accountId);
  const res = db.update(goals).set(v).where(eq(goals.id, id)).returning({ id: goals.id }).all();
  if (res.length === 0) throw new GoalError("not_found", "Goal not found");
}

export function deleteGoal(db: DbLike, id: number): boolean {
  return db.delete(goals).where(eq(goals.id, id)).returning({ id: goals.id }).all().length > 0;
}

/** Whole months between two dates, as a fraction (30.44-day months). */
function monthsBetween(from: string, to: string): number {
  return (dayNumber(to) - dayNumber(from)) / DAYS_PER_MONTH;
}

/** Progress for every goal, with what it would take to finish on time and when the current pace gets there. */
export function listGoalProgress(db: DbLike, now: number, timeZone: string): GoalProgress[] {
  const today = localDateString(now, timeZone);
  const rows = db
    .select({
      g: goals,
      accountName: accounts.name,
      displayName: accounts.displayName,
      currency: accounts.currency,
      balance: accounts.balanceCents,
    })
    .from(goals)
    .innerJoin(accounts, eq(accounts.id, goals.accountId))
    .orderBy(goals.createdAt, goals.id)
    .all();

  return rows.map(({ g, accountName, displayName, currency, balance }): GoalProgress => {
    const span = g.targetCents - g.startCents;
    const saved = Math.max(0, balance - g.startCents);
    const remaining = Math.max(0, g.targetCents - balance);
    const done = remaining === 0;

    // The account's growth over the last 90 days, from its daily balances.
    const series = balanceSeries(db, g.accountId, PACE_DAYS, now, timeZone);
    let recentPerMonth: number | null = null;
    if (series.length >= 2) {
      const first = series[0];
      const days = dayNumber(series[series.length - 1].date) - dayNumber(first.date);
      if (days >= 7) recentPerMonth = Math.round(((balance - first.balanceCents) / days) * DAYS_PER_MONTH);
    }
    const projectedDate =
      done || recentPerMonth === null || recentPerMonth <= 0
        ? null
        : addDaysToDate(today, Math.ceil((remaining / recentPerMonth) * DAYS_PER_MONTH));

    const monthsLeft = g.targetDate === null ? null : Math.max(0, monthsBetween(today, g.targetDate));
    const needed = done || monthsLeft === null ? null : monthsLeft < 1 ? remaining : Math.ceil(remaining / monthsLeft);

    let status: GoalStatus;
    if (done) status = "done";
    else if (g.targetDate === null) status = "no_date";
    else status = projectedDate !== null && projectedDate <= g.targetDate ? "on_track" : "behind";

    return {
      id: g.id,
      name: g.name,
      accountId: g.accountId,
      accountName: displayName?.trim() || accountName,
      currency,
      color: g.color,
      targetCents: g.targetCents,
      startCents: g.startCents,
      targetDate: g.targetDate,
      balanceCents: balance,
      savedCents: saved,
      remainingCents: remaining,
      fraction: Math.min(1, saved / span),
      status,
      monthsLeft,
      neededPerMonthCents: needed,
      recentPerMonthCents: recentPerMonth,
      projectedDate,
    };
  });
}
