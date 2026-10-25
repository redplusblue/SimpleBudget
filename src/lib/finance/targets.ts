import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { budgets, categories, tags, transactionTags, transactions } from "@/db/schema";
import { daysInMonth, localDateString, monthRange } from "./dates";
import { effectiveDateSql, expenseCondition } from "./sql";
import {
  MIN_DAYS_FOR_PROJECTION,
  targetInputSchema,
  targetPatchSchema,
  targetStatus,
  type TargetInput,
  type TargetPatch,
  type TargetProgress,
  type TargetRow,
} from "./targets-types";

export class TargetError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

export function listTargets(db: DbLike): TargetRow[] {
  const cats = db
    .select({
      id: budgets.id,
      subjectId: categories.id,
      name: categories.name,
      color: categories.color,
      icon: categories.icon,
      amountCents: budgets.amountCents,
      month: budgets.month,
    })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .all()
    .map((r): TargetRow => ({
      id: r.id,
      kind: "category",
      subjectId: r.subjectId,
      subjectName: r.name,
      subjectColor: r.color,
      subjectIcon: r.icon,
      amountCents: r.amountCents,
      month: r.month,
    }));
  const tagRows = db
    .select({
      id: budgets.id,
      subjectId: tags.id,
      name: tags.name,
      color: tags.color,
      amountCents: budgets.amountCents,
      month: budgets.month,
    })
    .from(budgets)
    .innerJoin(tags, eq(tags.id, budgets.tagId))
    .all()
    .map((r): TargetRow => ({
      id: r.id,
      kind: "tag",
      subjectId: r.subjectId,
      subjectName: r.name,
      subjectColor: r.color,
      subjectIcon: null,
      amountCents: r.amountCents,
      month: r.month,
    }));
  // Recurring targets first, then specific months, each by name.
  return [...cats, ...tagRows].sort(
    (a, b) => a.subjectName.localeCompare(b.subjectName) || (a.month ?? "").localeCompare(b.month ?? "") || a.id - b.id,
  );
}

function assertSubject(db: DbLike, kind: "category" | "tag", subjectId: number) {
  const found =
    kind === "category"
      ? db.select({ id: categories.id }).from(categories).where(eq(categories.id, subjectId)).get()
      : db.select({ id: tags.id }).from(tags).where(eq(tags.id, subjectId)).get();
  if (!found)
    throw new TargetError(
      "invalid",
      kind === "category" ? "That category no longer exists" : "That tag no longer exists",
    );
}

function findClash(db: DbLike, kind: "category" | "tag", subjectId: number, month: string | null, exceptId?: number) {
  const subject = kind === "category" ? eq(budgets.categoryId, subjectId) : eq(budgets.tagId, subjectId);
  const scope = month === null ? sql`${budgets.month} IS NULL` : eq(budgets.month, month);
  return db
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(subject, scope))
    .all()
    .find((b) => b.id !== exceptId);
}

const conflictMessage = (month: string | null) =>
  month === null ? "There's already a recurring target for this" : `There's already a target for ${month}`;

export function createTarget(db: DbLike, input: TargetInput): TargetRow {
  const v = targetInputSchema.parse(input);
  assertSubject(db, v.kind, v.subjectId);
  if (findClash(db, v.kind, v.subjectId, v.month)) throw new TargetError("conflict", conflictMessage(v.month));
  const row = db
    .insert(budgets)
    .values({
      categoryId: v.kind === "category" ? v.subjectId : null,
      tagId: v.kind === "tag" ? v.subjectId : null,
      month: v.month,
      amountCents: v.amountCents,
    })
    .returning({ id: budgets.id })
    .get();
  return listTargets(db).find((t) => t.id === row.id)!;
}

export function updateTarget(db: DbLike, id: number, patch: TargetPatch): TargetRow {
  const v = targetPatchSchema.parse(patch);
  const current = db.select().from(budgets).where(eq(budgets.id, id)).get();
  if (!current) throw new TargetError("not_found", "Target not found");
  const month = v.month !== undefined ? v.month : current.month;
  const kind = current.categoryId !== null ? "category" : "tag";
  const subjectId = (current.categoryId ?? current.tagId)!;
  if (findClash(db, kind, subjectId, month, id)) throw new TargetError("conflict", conflictMessage(month));
  db.update(budgets)
    .set({ ...(v.amountCents !== undefined ? { amountCents: v.amountCents } : {}), month })
    .where(eq(budgets.id, id))
    .run();
  return listTargets(db).find((t) => t.id === id)!;
}

export function deleteTarget(db: DbLike, id: number): boolean {
  return db.delete(budgets).where(eq(budgets.id, id)).returning({ id: budgets.id }).all().length > 0;
}

/**
 * The targets that apply to `month`: for each category or tag, a target set for exactly that month wins over its
 * recurring one, and targets for other months are ignored.
 */
export function effectiveTargets(rows: TargetRow[], month: string): TargetRow[] {
  const chosen = new Map<string, TargetRow>();
  for (const r of rows) {
    if (r.month !== null && r.month !== month) continue;
    const key = `${r.kind}:${r.subjectId}`;
    const existing = chosen.get(key);
    if (!existing || (existing.month === null && r.month !== null)) chosen.set(key, r);
  }
  return [...chosen.values()];
}

/** Spending per category / tag for a month, limited to the subjects that have targets. */
function spentBySubject(db: DbLike, month: string, timeZone: string, categoryIds: number[], tagIds: number[]) {
  const { start, end } = monthRange(month, timeZone);
  const window = and(expenseCondition, sql`${effectiveDateSql} >= ${start}`, sql`${effectiveDateSql} < ${end}`);
  const byCategory = new Map<number, number>();
  const byTag = new Map<number, number>();
  if (categoryIds.length) {
    const rows = db
      .select({ id: transactions.categoryId, cents: sql<number>`-sum(${transactions.amountCents})` })
      .from(transactions)
      .where(and(window, inArray(transactions.categoryId, categoryIds)))
      .groupBy(transactions.categoryId)
      .all();
    for (const r of rows) if (r.id !== null) byCategory.set(r.id, r.cents);
  }
  if (tagIds.length) {
    const rows = db
      .select({ id: transactionTags.tagId, cents: sql<number>`-sum(${transactions.amountCents})` })
      .from(transactionTags)
      .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
      .where(and(window, inArray(transactionTags.tagId, tagIds)))
      .groupBy(transactionTags.tagId)
      .all();
    for (const r of rows) byTag.set(r.id, r.cents);
  }
  return { byCategory, byTag };
}

/** Progress for every target that applies to `month`, most-used first. Empty when there are no targets. */
export function getTargetProgress(db: DbLike, month: string, now: number, timeZone: string): TargetProgress[] {
  const targets = effectiveTargets(listTargets(db), month);
  if (targets.length === 0) return [];

  const { byCategory, byTag } = spentBySubject(
    db,
    month,
    timeZone,
    targets.filter((t) => t.kind === "category").map((t) => t.subjectId),
    targets.filter((t) => t.kind === "tag").map((t) => t.subjectId),
  );

  const today = localDateString(now, timeZone);
  const days = daysInMonth(month);
  const isCurrent = today.slice(0, 7) === month;
  const elapsed = isCurrent ? Number(today.slice(8, 10)) : 0;

  return targets
    .map((t): TargetProgress => {
      const spentCents = (t.kind === "category" ? byCategory : byTag).get(t.subjectId) ?? 0;
      const fraction = spentCents / t.amountCents;
      const projectedCents =
        isCurrent && elapsed >= MIN_DAYS_FOR_PROJECTION ? Math.round((spentCents * days) / elapsed) : null;
      return {
        id: t.id,
        kind: t.kind,
        subjectId: t.subjectId,
        name: t.subjectName,
        color: t.subjectColor,
        icon: t.subjectIcon,
        amountCents: t.amountCents,
        spentCents,
        remainingCents: t.amountCents - spentCents,
        fraction,
        status: targetStatus(fraction),
        scope: t.month === null ? "recurring" : "month",
        projectedCents,
        onPaceToExceed: fraction <= 1 && projectedCents !== null && projectedCents > t.amountCents,
      };
    })
    .sort((a, b) => b.fraction - a.fraction || a.name.localeCompare(b.name));
}
