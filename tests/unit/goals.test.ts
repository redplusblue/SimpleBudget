import { describe, expect, it } from "vitest";
import { balanceSnapshots } from "@/db/schema";
import { addDaysToDate, zonedDayStart } from "@/lib/finance/dates";
import { createGoal, deleteGoal, GoalError, listGoalProgress, updateGoal } from "@/lib/finance/goals";
import { goalInputSchema } from "@/lib/finance/goals-types";
import { addAccount, freshDb } from "../helpers/db";

const TZ = "UTC";
const NOW = zonedDayStart("2026-10-24", TZ) + 12 * 3600;
const TODAY = "2026-10-24";

/** A savings account that grew from $1,000 to $2,800 over the last 90 days (a straight line). */
function dataset(balance = 280_000, from = 100_000) {
  const db = freshDb();
  addAccount(db, "sav", { name: "Savings", displayName: "Rainy day", balanceCents: balance, type: "savings" });
  for (let back = 0; back < 90; back++) {
    db.insert(balanceSnapshots)
      .values({
        accountId: "sav",
        date: addDaysToDate(TODAY, -back),
        balanceCents: Math.round(balance - ((balance - from) * back) / 89),
      })
      .run();
  }
  return db;
}
const goal = (over: object = {}) => ({
  name: "Emergency fund",
  accountId: "sav",
  targetCents: 500_000,
  startCents: 50_000,
  ...over,
});

describe("goalInputSchema", () => {
  it("validates", () => {
    expect(goalInputSchema.safeParse(goal()).success).toBe(true);
    expect(goalInputSchema.safeParse(goal({ name: " " })).success).toBe(false);
    expect(goalInputSchema.safeParse(goal({ targetCents: 0 })).success).toBe(false);
    expect(goalInputSchema.safeParse(goal({ startCents: 500_000 })).success).toBe(false); // start must be below target
    expect(goalInputSchema.safeParse(goal({ targetDate: "June 2027" })).success).toBe(false);
    expect(goalInputSchema.parse(goal({ targetDate: "", color: undefined }))).toMatchObject({
      targetDate: null,
      color: null,
    });
  });
});

describe("goal CRUD", () => {
  it("creates, updates and deletes, and refuses unknown accounts", () => {
    const db = dataset();
    const id = createGoal(db, goal());
    expect(listGoalProgress(db, NOW, TZ)).toHaveLength(1);
    updateGoal(db, id, goal({ name: "Safety net", targetCents: 600_000 }));
    expect(listGoalProgress(db, NOW, TZ)[0]).toMatchObject({ name: "Safety net", targetCents: 600_000 });
    expect(() => createGoal(db, goal({ accountId: "nope" }))).toThrow(/no longer exists/);
    expect(() => updateGoal(db, 999, goal())).toThrow(GoalError);
    expect(deleteGoal(db, id)).toBe(true);
    expect(deleteGoal(db, id)).toBe(false);
  });

  it("disappears with its account", () => {
    const db = dataset();
    createGoal(db, goal());
    db.$client.prepare("DELETE FROM accounts WHERE id = 'sav'").run();
    expect(listGoalProgress(db, NOW, TZ)).toEqual([]);
  });
});

describe("listGoalProgress", () => {
  it("measures progress above the starting amount", () => {
    const db = dataset();
    createGoal(db, goal());
    const [g] = listGoalProgress(db, NOW, TZ);
    expect(g).toMatchObject({
      accountName: "Rainy day",
      balanceCents: 280_000,
      savedCents: 230_000,
      remainingCents: 220_000,
      status: "no_date",
    });
    expect(g.fraction).toBeCloseTo(230_000 / 450_000);
    expect(g).toMatchObject({ monthsLeft: null, neededPerMonthCents: null });
  });

  it("projects completion from the recent pace", () => {
    const db = dataset();
    createGoal(db, goal());
    const [g] = listGoalProgress(db, NOW, TZ);
    // +$1,800 over 89 days = $615.66 a month; $2,200 left -> about 3.57 months
    expect(g.recentPerMonthCents).toBe(Math.round((180_000 / 89) * 30.4375));
    expect(g.projectedDate).toBe(addDaysToDate(TODAY, Math.ceil((220_000 / g.recentPerMonthCents!) * 30.4375)));
    expect(g.projectedDate! > "2027-01-01" && g.projectedDate! < "2027-03-01").toBe(true);
  });

  it("is on track when the pace beats the deadline and behind when it doesn't", () => {
    const db = dataset();
    createGoal(db, goal({ targetDate: "2027-06-30" }));
    createGoal(db, goal({ name: "Sooner", targetDate: "2026-12-31" }));
    const [late, soon] = listGoalProgress(db, NOW, TZ);
    expect(late.status).toBe("on_track");
    expect(soon.status).toBe("behind");
    expect(soon.monthsLeft).toBeCloseTo(68 / 30.4375, 1); // Oct 24 -> Dec 31
    expect(soon.neededPerMonthCents).toBe(Math.ceil(220_000 / soon.monthsLeft!));
    expect(late.neededPerMonthCents!).toBeLessThan(soon.neededPerMonthCents!);
  });

  it("is done once the balance reaches the target", () => {
    const db = dataset();
    createGoal(db, goal({ targetCents: 250_000, targetDate: "2027-01-01" }));
    const [g] = listGoalProgress(db, NOW, TZ);
    expect(g).toMatchObject({
      status: "done",
      remainingCents: 0,
      fraction: 1,
      neededPerMonthCents: null,
      projectedDate: null,
    });
  });

  it("has no projection when the balance is flat or falling, or history is short", () => {
    const falling = dataset(100_000, 300_000);
    createGoal(falling, goal({ startCents: 0, targetDate: "2027-12-31" }));
    expect(listGoalProgress(falling, NOW, TZ)[0]).toMatchObject({ projectedDate: null, status: "behind" });
    expect(listGoalProgress(falling, NOW, TZ)[0].recentPerMonthCents!).toBeLessThan(0);

    const fresh = freshDb();
    addAccount(fresh, "sav", { balanceCents: 50_000 });
    createGoal(fresh, goal({ startCents: 0 }));
    expect(listGoalProgress(fresh, NOW, TZ)[0]).toMatchObject({ recentPerMonthCents: null, projectedDate: null });
  });

  it("a past target date asks for the whole remainder now", () => {
    const db = dataset();
    createGoal(db, goal({ targetDate: "2026-09-01" }));
    const [g] = listGoalProgress(db, NOW, TZ);
    expect(g).toMatchObject({ monthsLeft: 0, neededPerMonthCents: 220_000, status: "behind" });
  });

  it("progress never goes negative when the balance is below the starting amount", () => {
    const db = dataset(30_000, 10_000);
    createGoal(db, goal());
    expect(listGoalProgress(db, NOW, TZ)[0]).toMatchObject({ savedCents: 0, fraction: 0 });
  });
});
