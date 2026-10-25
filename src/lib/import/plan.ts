import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { paletteColor } from "@/db/palette";
import { accounts, categories, transactionSplits, transactions } from "@/db/schema";
import { localDateString, zonedDayStart } from "@/lib/finance/dates";
import { detectTransfers } from "@/lib/finance/transfers";
import { effectiveDateSql } from "@/lib/finance/sql";
import { applyRulesToNew } from "@/lib/rules/store";
import { accountLabels, mappingProblem, parseImportFile } from "./parse";
import {
  importRequestSchema,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type ParseProblem,
  type PlannedRow,
} from "./types";

export class ImportError extends Error {
  readonly code = "invalid" as const;
}

/** A file row and an existing transaction are "the same" when the amount is equal and the dates are within this many days. */
export const MATCH_WINDOW_DAYS = 2;
export const SAMPLE_INSERTS = 15;
export const SAMPLE_MATCHES = 15;
export const SAMPLE_SKIPS = 10;

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const keyOf = (name: string) => name.trim().toLowerCase();

interface Candidate {
  id: number;
  day: number;
  categoryId: number | null;
  hasNotes: boolean;
  hasSplits: boolean;
  claimed: boolean;
}

export interface Plan {
  rows: PlannedRow[];
  problems: ParseProblem[];
  newCategories: string[];
  newAccounts: string[];
  dataRows: number;
}

/** Works out, without writing anything, what each row of the file would do. */
export function planImport(db: DbLike, input: unknown, timeZone: string): Plan {
  const req = importRequestSchema.parse(input);
  const bad = mappingProblem(req.mapping);
  if (bad) throw new ImportError(bad);
  const parsed = parseImportFile(req.csv, req.hasHeader, req.dateFormat, req.mapping);
  const labels = accountLabels(parsed.rows);

  // Which existing transactions each destination account already has, by amount.
  const existingIds = new Set(
    labels.flatMap((l) => {
      const t = req.accounts[l];
      return t?.type === "existing" ? [t.accountId] : [];
    }),
  );
  const known = new Set(
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(existingIds.size ? inArray(accounts.id, [...existingIds]) : undefined)
      .all()
      .map((a) => a.id),
  );
  const byAccount = new Map<string, { byAmount: Map<number, Candidate[]>; historyStart: number | null }>();
  for (const accountId of existingIds) {
    if (!known.has(accountId)) continue;
    const rows = db
      .select({
        id: transactions.id,
        at: effectiveDateSql,
        cents: transactions.amountCents,
        categoryId: transactions.categoryId,
        notes: transactions.notes,
        source: transactions.source,
        splits: transactionSplits.id,
      })
      .from(transactions)
      .leftJoin(transactionSplits, eq(transactionSplits.transactionId, transactions.id))
      .where(eq(transactions.accountId, accountId))
      .all();
    const byAmount = new Map<number, Candidate[]>();
    let historyStart: number | null = null;
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const day = dayNumber(localDateString(r.at, timeZone));
      if (r.source === "simplefin" && (historyStart === null || day < historyStart)) historyStart = day;
      const list = byAmount.get(r.cents) ?? [];
      list.push({
        id: r.id,
        day,
        categoryId: r.categoryId,
        hasNotes: !!r.notes?.trim(),
        hasSplits: r.splits !== null,
        claimed: false,
      });
      byAmount.set(r.cents, list);
    }
    byAccount.set(accountId, { byAmount, historyStart });
  }

  const existingCategories = new Set(
    db
      .select({ name: categories.name })
      .from(categories)
      .all()
      .map((c) => keyOf(c.name)),
  );
  const newCategories = new Map<string, string>();
  const newAccounts: string[] = [];
  const planned: PlannedRow[] = [];

  for (const row of parsed.rows) {
    const target = req.accounts[row.accountLabel];
    const base = { ...row, matchId: null, accountId: null, fills: [] as Array<"category" | "notes"> };
    if (!target || target.type === "skip") {
      planned.push({
        ...base,
        action: "skip",
        reason: target ? "You chose to skip this account" : "No account chosen",
      });
      continue;
    }
    if (target.type === "new") {
      if (!newAccounts.includes(target.name)) newAccounts.push(target.name);
      planned.push({ ...base, action: "insert", reason: null });
      noteCategory(row.category);
      continue;
    }
    const info = byAccount.get(target.accountId);
    if (!info) {
      planned.push({ ...base, accountId: target.accountId, action: "skip", reason: "That account no longer exists" });
      continue;
    }
    const day = dayNumber(row.date);
    const match = (info.byAmount.get(row.amountCents) ?? [])
      .filter((c) => !c.claimed && Math.abs(c.day - day) <= MATCH_WINDOW_DAYS)
      .sort((a, b) => Math.abs(a.day - day) - Math.abs(b.day - day) || a.id - b.id)[0];
    if (match) {
      match.claimed = true;
      // Only fill what's empty; never overwrite something you or a rule already set.
      const fills: Array<"category" | "notes"> = [];
      if (row.category && match.categoryId === null && !match.hasSplits) fills.push("category");
      if (row.notes && !match.hasNotes) fills.push("notes");
      planned.push({
        ...base,
        accountId: target.accountId,
        action: "match",
        matchId: match.id,
        fills,
        reason: fills.length ? null : "Already in your records",
      });
      if (fills.includes("category")) noteCategory(row.category);
    } else if (info.historyStart === null || day < info.historyStart) {
      planned.push({ ...base, accountId: target.accountId, action: "insert", reason: null });
      noteCategory(row.category);
    } else {
      planned.push({
        ...base,
        accountId: target.accountId,
        action: "skip",
        reason: "Inside your synced history with no matching transaction (skipped to avoid duplicates)",
      });
    }
  }

  function noteCategory(name: string) {
    const trimmed = name.trim();
    if (trimmed && !existingCategories.has(keyOf(trimmed)) && !newCategories.has(keyOf(trimmed)))
      newCategories.set(keyOf(trimmed), trimmed.slice(0, 60));
  }

  return {
    rows: planned,
    problems: parsed.problems,
    newCategories: [...newCategories.values()],
    newAccounts,
    dataRows: parsed.dataRows,
  };
}

function summarize(plan: Plan): ImportPreview {
  const count = (a: PlannedRow["action"]) => plan.rows.filter((r) => r.action === a).length;
  const reasons = new Map<string, number>();
  for (const r of plan.rows)
    if (r.action === "skip" && r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  const pick = (a: PlannedRow["action"], n: number) => plan.rows.filter((r) => r.action === a).slice(0, n);
  return {
    totalRows: plan.dataRows,
    matches: count("match"),
    inserts: count("insert"),
    skipped: count("skip"),
    problems: plan.problems.slice(0, 50),
    newCategories: plan.newCategories,
    newAccounts: plan.newAccounts,
    sample: [...pick("insert", SAMPLE_INSERTS), ...pick("match", SAMPLE_MATCHES), ...pick("skip", SAMPLE_SKIPS)],
    skipReasons: [...reasons].map(([reason, n]) => ({ reason, count: n })).sort((a, b) => b.count - a.count),
  };
}

export function previewImport(db: DbLike, input: unknown, timeZone: string): ImportPreview {
  return summarize(planImport(db, input, timeZone));
}

/** Applies the plan in one transaction, then pairs transfers and runs rules over the new rows. */
export function commitImport(db: DbLike, input: unknown, now: number, timeZone: string): ImportResult {
  const plan = planImport(db, input, timeZone);
  const req = importRequestSchema.parse(input) as ImportRequest;
  const insertedIds: number[] = [];
  let updated = 0;
  let categoriesCreated = 0;
  let accountsCreated = 0;

  db.transaction((tx) => {
    // New accounts (manual, so syncing never touches them).
    const newAccountIds = new Map<string, string>();
    for (const name of plan.newAccounts) {
      const id = `manual-import-${createHash("sha1").update(`${name}|${now}|${newAccountIds.size}`).digest("hex").slice(0, 16)}`;
      tx.insert(accounts)
        .values({
          id,
          connectionId: null,
          orgName: "Imported",
          name,
          type: "other",
          isManual: true,
          balanceCents: 0,
          balanceDate: now,
        })
        .run();
      newAccountIds.set(name, id);
      accountsCreated++;
    }

    // New categories; ones that only ever receive money are marked as income.
    const categoryByKey = new Map(
      tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .all()
        .map((c) => [keyOf(c.name), c.id]),
    );
    const order = tx.select().from(categories).all().length;
    for (const name of plan.newCategories) {
      const used = plan.rows.filter((r) => keyOf(r.category) === keyOf(name) && r.action !== "skip");
      const row = tx
        .insert(categories)
        .values({
          name,
          color: paletteColor(order + categoriesCreated),
          sortOrder: order + categoriesCreated,
          isIncome: used.length > 0 && used.every((r) => r.amountCents > 0),
        })
        .returning({ id: categories.id })
        .get();
      categoryByKey.set(keyOf(name), row.id);
      categoriesCreated++;
    }
    const catId = (name: string) => (name.trim() ? (categoryByKey.get(keyOf(name)) ?? null) : null);

    const occurrences = new Map<string, number>();
    for (const r of plan.rows) {
      if (r.action === "match" && r.matchId !== null && r.fills.length) {
        const set: Partial<typeof transactions.$inferInsert> = {};
        if (r.fills.includes("category")) set.categoryId = catId(r.category);
        if (r.fills.includes("notes")) set.notes = r.notes;
        tx.update(transactions)
          .set({ ...set, updatedAt: now })
          .where(eq(transactions.id, r.matchId))
          .run();
        updated++;
      } else if (r.action === "insert") {
        const target = req.accounts[r.accountLabel];
        const accountId = r.accountId ?? (target?.type === "new" ? newAccountIds.get(target.name) : undefined);
        if (!accountId) continue;
        const key = `${accountId}|${r.date}|${r.amountCents}|${r.payee}`;
        const n = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, n);
        const id = tx
          .insert(transactions)
          .values({
            accountId,
            sfTxnId: `import-${createHash("sha1").update(`${key}|${n}`).digest("hex")}`,
            posted: zonedDayStart(r.date, timeZone) + 12 * 3600,
            amountCents: r.amountCents,
            description: r.payee || r.notes || "Imported transaction",
            payee: r.payee || null,
            notes: r.notes || null,
            categoryId: catId(r.category),
            source: "import",
            rawJson: JSON.stringify({
              line: r.line,
              account: r.accountLabel,
              payee: r.payee,
              notes: r.notes,
              category: r.category,
            }),
            isReviewed: true,
          })
          .returning({ id: transactions.id })
          .get().id;
        insertedIds.push(id);
      }
    }
  });

  // Transfers between imported accounts and rule-based categories for what the file didn't categorize.
  detectTransfers(db, insertedIds);
  applyRulesToNew(db, insertedIds);

  return { ...summarize(plan), inserted: insertedIds.length, updated, categoriesCreated, accountsCreated };
}
