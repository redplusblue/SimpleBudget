import { describe, expect, it } from "vitest";
import { budgets, transactionTags } from "@/db/schema";
import { zonedDayStart } from "@/lib/finance/dates";
import {
  createTarget,
  deleteTarget,
  effectiveTargets,
  getTargetProgress,
  listTargets,
  TargetError,
  updateTarget,
} from "@/lib/finance/targets";
import { targetInputSchema, targetStatus, type TargetRow } from "@/lib/finance/targets-types";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

/** October as of the 24th: Groceries 150, Dining 50 (both tagged "work"), Transport 40, uncategorized 200. */
function dataset() {
  const db = freshDb();
  addAccount(db, "A");
  const [groceries, dining, transport] = ["Groceries", "Dining", "Transport"].map((n) => categoryId(db, n));
  const work = addTag(db, "work");
  const spend = (date: string, dollars: number, category?: number, extra: Parameters<typeof addTxn>[2] = {}) =>
    addTxn(db, "A", { posted: at(date), amountCents: -dollars * 100, categoryId: category, ...extra });
  spend("2026-10-01", 100, groceries);
  spend("2026-10-03", 50, groceries);
  const d1 = spend("2026-10-05", 30, dining);
  const d2 = spend("2026-10-05", 20, dining);
  db.insert(transactionTags)
    .values([
      { transactionId: d1.id, tagId: work.id },
      { transactionId: d2.id, tagId: work.id },
    ])
    .run();
  spend("2026-10-24", 40, transport);
  spend("2026-10-10", 200);
  spend("2026-10-06", 500, groceries, { isTransfer: true }); // never counts
  spend("2026-10-07", 60, groceries, { isExcluded: true }); // never counts
  spend("2026-09-02", 80, groceries);
  return { db, groceries, dining, transport, work };
}

describe("targetStatus", () => {
  it.each([
    [0, "ok"],
    [0.79, "ok"],
    [0.8, "warning"],
    [1, "warning"], // exactly at the target is not "over" yet
    [1.0001, "over"],
    [3, "over"],
  ])("%d → %s", (fraction, status) => expect(targetStatus(fraction)).toBe(status));
});

describe("creating and editing targets", () => {
  it("creates category and tag targets and lists them with their subject details", () => {
    const { db, groceries, work } = dataset();
    const a = createTarget(db, { kind: "category", subjectId: groceries, amountCents: 20_000 });
    const b = createTarget(db, { kind: "tag", subjectId: work.id, amountCents: 10_000, month: "2026-10" });
    expect(a).toMatchObject({ kind: "category", subjectName: "Groceries", amountCents: 20_000, month: null });
    expect(b).toMatchObject({ kind: "tag", subjectName: "work", month: "2026-10", subjectIcon: null });
    expect(
      listTargets(db)
        .map((t) => t.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it("allows a recurring target plus a different one for a specific month", () => {
    const { db, groceries } = dataset();
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 20_000 });
    expect(() =>
      createTarget(db, { kind: "category", subjectId: groceries, amountCents: 30_000, month: "2026-12" }),
    ).not.toThrow();
  });

  it("refuses duplicates for the same subject and scope", () => {
    const { db, groceries } = dataset();
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 20_000 });
    expect(() => createTarget(db, { kind: "category", subjectId: groceries, amountCents: 1 })).toThrow(
      /already a recurring target/,
    );
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 5_000, month: "2026-10" });
    expect(() =>
      createTarget(db, { kind: "category", subjectId: groceries, amountCents: 1, month: "2026-10" }),
    ).toThrow(/already a target for 2026-10/);
    expect(listTargets(db)).toHaveLength(2);
  });

  it("validates input and referenced rows", () => {
    const { db, groceries } = dataset();
    expect(() => createTarget(db, { kind: "category", subjectId: 9999, amountCents: 100 })).toThrow(
      /category no longer exists/,
    );
    expect(() => createTarget(db, { kind: "tag", subjectId: 9999, amountCents: 100 })).toThrow(/tag no longer exists/);
    for (const bad of [
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 1.5 },
      { amountCents: 100_000_000_001 },
      { amountCents: 100, month: "2026-13" },
      { amountCents: 100, month: "October" },
    ]) {
      expect(targetInputSchema.safeParse({ kind: "category", subjectId: groceries, ...bad }).success).toBe(false);
    }
    expect(() => createTarget(db, { kind: "category", subjectId: groceries, amountCents: 0 })).toThrow();
  });

  it("updates amount and scope, checking for clashes", () => {
    const { db, groceries } = dataset();
    const recurring = createTarget(db, { kind: "category", subjectId: groceries, amountCents: 20_000 });
    const october = createTarget(db, { kind: "category", subjectId: groceries, amountCents: 5_000, month: "2026-10" });
    expect(updateTarget(db, recurring.id, { amountCents: 25_000 })).toMatchObject({ amountCents: 25_000, month: null });
    expect(updateTarget(db, october.id, { month: "2026-11" })).toMatchObject({ month: "2026-11", amountCents: 5_000 });
    expect(() => updateTarget(db, october.id, { month: null })).toThrow(TargetError); // would clash with the recurring one
    expect(updateTarget(db, october.id, { amountCents: 6_000 }).month).toBe("2026-11"); // unchanged scope isn't a clash with itself
    expect(() => updateTarget(db, 9999, { amountCents: 1 })).toThrow(/not found/);
    expect(() => updateTarget(db, recurring.id, {})).toThrow();
  });

  it("deletes", () => {
    const { db, groceries } = dataset();
    const t = createTarget(db, { kind: "category", subjectId: groceries, amountCents: 1 });
    expect(deleteTarget(db, t.id)).toBe(true);
    expect(deleteTarget(db, t.id)).toBe(false);
  });

  it("the database itself refuses a target with both or neither subject, or a duplicate scope", () => {
    const { db, groceries, work } = dataset();
    expect(() => db.insert(budgets).values({ categoryId: groceries, tagId: work.id, amountCents: 1 }).run()).toThrow(
      /exactly one/,
    );
    expect(() => db.insert(budgets).values({ amountCents: 1 }).run()).toThrow(/exactly one/);
    db.insert(budgets).values({ categoryId: groceries, amountCents: 1 }).run();
    expect(() => db.insert(budgets).values({ categoryId: groceries, amountCents: 2 }).run()).toThrow(/UNIQUE/);
    db.insert(budgets).values({ categoryId: groceries, month: "2026-10", amountCents: 2 }).run();
    expect(() => db.insert(budgets).values({ categoryId: groceries, month: "2026-10", amountCents: 3 }).run()).toThrow(
      /UNIQUE/,
    );
  });

  it("targets disappear with their category or tag", () => {
    const { db, work } = dataset();
    createTarget(db, { kind: "tag", subjectId: work.id, amountCents: 100 });
    db.run(sqlDeleteTag(work.id));
    expect(listTargets(db)).toEqual([]);
  });
});

import { sql } from "drizzle-orm";
const sqlDeleteTag = (id: number) => sql`DELETE FROM tags WHERE id = ${id}`;

describe("effectiveTargets", () => {
  const row = (
    id: number,
    subjectId: number,
    month: string | null,
    kind: "category" | "tag" = "category",
  ): TargetRow => ({
    id,
    kind,
    subjectId,
    subjectName: `s${subjectId}`,
    subjectColor: "#000",
    subjectIcon: null,
    amountCents: id * 100,
    month,
  });
  it("prefers the specific month over the recurring target and ignores other months", () => {
    const rows = [
      row(1, 1, null),
      row(2, 1, "2026-10"),
      row(3, 1, "2026-11"),
      row(4, 2, "2026-11"),
      row(5, 3, null),
      row(6, 1, null, "tag"),
    ];
    expect(
      effectiveTargets(rows, "2026-10")
        .map((r) => r.id)
        .sort(),
    ).toEqual([2, 5, 6]);
    expect(
      effectiveTargets(rows, "2026-11")
        .map((r) => r.id)
        .sort(),
    ).toEqual([3, 4, 5, 6]);
    expect(
      effectiveTargets(rows, "2026-12")
        .map((r) => r.id)
        .sort(),
    ).toEqual([1, 5, 6]);
    expect(effectiveTargets([], "2026-10")).toEqual([]);
  });
});

describe("getTargetProgress", () => {
  function withTargets() {
    const ctx = dataset();
    createTarget(ctx.db, { kind: "category", subjectId: ctx.groceries, amountCents: 20_000 });
    createTarget(ctx.db, { kind: "category", subjectId: ctx.dining, amountCents: 5_000 });
    createTarget(ctx.db, { kind: "category", subjectId: ctx.transport, amountCents: 3_000 });
    createTarget(ctx.db, { kind: "tag", subjectId: ctx.work.id, amountCents: 10_000, month: "2026-10" });
    return ctx;
  }

  it("is empty when there are no targets", () => {
    expect(getTargetProgress(dataset().db, "2026-10", NOW, TZ)).toEqual([]);
  });

  it("measures spending against each target with status, remaining and projection", () => {
    const p = getTargetProgress(withTargets().db, "2026-10", NOW, TZ);
    const by = Object.fromEntries(p.map((t) => [t.name, t]));
    // Groceries: 150 of 200 (transfer and excluded items don't count), on pace for 150 * 31 / 24
    expect(by.Groceries).toMatchObject({
      spentCents: 15_000,
      remainingCents: 5_000,
      status: "ok",
      scope: "recurring",
      projectedCents: Math.round((15_000 * 31) / 24),
      onPaceToExceed: false,
    });
    expect(by.Groceries.fraction).toBeCloseTo(0.75);
    // Dining: exactly at the target is a warning, not over; the pace says it will exceed
    expect(by.Dining).toMatchObject({ spentCents: 5_000, remainingCents: 0, status: "warning", onPaceToExceed: true });
    // Transport: 40 of 30
    expect(by.Transport).toMatchObject({
      spentCents: 4_000,
      remainingCents: -1_000,
      status: "over",
      onPaceToExceed: false,
    });
    // The tag target covers the two tagged dining purchases and is specific to this month
    expect(by.work).toMatchObject({ kind: "tag", spentCents: 5_000, status: "ok", scope: "month" });
  });

  it("orders by how much of the target is used", () => {
    expect(getTargetProgress(withTargets().db, "2026-10", NOW, TZ).map((t) => t.name)).toEqual([
      "Transport",
      "Dining",
      "Groceries",
      "work",
    ]);
  });

  it("uses a month-specific target instead of the recurring one for that month", () => {
    const { db, groceries } = dataset();
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 20_000 });
    createTarget(db, { kind: "category", subjectId: groceries, amountCents: 10_000, month: "2026-09" });
    const sept = getTargetProgress(db, "2026-09", NOW, TZ)[0];
    expect(sept).toMatchObject({
      amountCents: 10_000,
      spentCents: 8_000,
      scope: "month",
      status: "warning",
      projectedCents: null,
    }); // 80% is the warning line
    expect(getTargetProgress(db, "2026-10", NOW, TZ)[0]).toMatchObject({ amountCents: 20_000, scope: "recurring" });
  });

  it("shows no projection for past months or in the first days of a month", () => {
    const { db } = withTargets();
    expect(getTargetProgress(db, "2026-09", NOW, TZ).every((t) => t.projectedCents === null)).toBe(true);
    expect(
      getTargetProgress(db, "2026-10", at("2026-10-02"), TZ).every(
        (t) => t.projectedCents === null && !t.onPaceToExceed,
      ),
    ).toBe(true);
    expect(getTargetProgress(db, "2026-10", at("2026-10-03"), TZ).every((t) => t.projectedCents !== null)).toBe(true);
  });

  it("reports zero spending for a target with nothing in the month", () => {
    const { db } = withTargets();
    const nov = getTargetProgress(db, "2026-11", NOW, TZ);
    expect(nov.map((t) => t.name).sort()).toEqual(["Dining", "Groceries", "Transport"]); // the tag target was October-only
    expect(nov.every((t) => t.spentCents === 0 && t.status === "ok" && t.remainingCents === t.amountCents)).toBe(true);
  });

  it("buckets purchases into the user's local month", () => {
    const db = freshDb();
    addAccount(db, "A");
    const cat = categoryId(db, "Dining");
    createTarget(db, { kind: "category", subjectId: cat, amountCents: 10_000 });
    addTxn(db, "A", { posted: zonedDayStart("2026-11-01", "UTC") + 2 * 3600, amountCents: -3_000, categoryId: cat }); // still Oct 31 in New York
    expect(getTargetProgress(db, "2026-10", NOW, "America/New_York")[0].spentCents).toBe(3_000);
    expect(getTargetProgress(db, "2026-10", NOW, "UTC")[0].spentCents).toBe(0);
  });
});
