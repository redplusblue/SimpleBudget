import { and, count, eq, gte, sql } from "drizzle-orm";
import { accounts, categories, transactions } from "@/db/schema";
import { monthSpan, spendingHref, transactionsHref } from "@/components/spending/links";
import { formatCents } from "@/lib/finance/cents";
import { addDaysToDate, daysInMonth, monthRange, shiftMonth } from "@/lib/finance/dates";
import { detectRecurring, MIN_OCCURRENCES } from "@/lib/finance/recurring";
import { getSpendingReport, merchantName } from "@/lib/finance/spending-report";
import { dailySpending } from "@/lib/finance/spending";
import { median, meanAndStdDev, type InsightContext, type TxnRow } from "./data";
import type { Insight } from "./types";

const $ = (cents: number) => formatCents(cents, { hideZeroCents: true });
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

// Thresholds, from the plan unless noted.
export const CATEGORY_CHANGE_PCT = 0.25;
export const CATEGORY_CHANGE_MIN_CENTS = 50_00;
export const NEW_MERCHANT_MEDIAN_MULTIPLE = 2;
export const NEW_MERCHANT_WINDOW_DAYS = 14;
export const OUTLIER_SIGMAS = 3;
export const OUTLIER_MIN_SAMPLES = 10;
export const OUTLIER_MIN_CENTS = 50_00;
export const OUTLIER_WINDOW_DAYS = 14;
export const PACE_MIN_DAYS = 5;
export const PACE_BAND = 0.1;
export const DUPLICATE_WINDOW_SECONDS = 48 * 3600;
export const DUPLICATE_LOOKBACK_DAYS = 14;
export const INCOME_MIN_CENTS = 100_00;
export const INCOME_RECENT_DAYS = 7;
export const INCOME_CHANGE_PCT = 0.02;
export const UTILIZATION_INFO = 0.3;
export const UTILIZATION_WARN = 0.5;
export const UNCATEGORIZED_MIN = 5;
/** Without this much history, "new merchant" would flag everything. */
export const MIN_HISTORY_DAYS = 45;

const CADENCE_PHRASE = {
  weekly: "per week",
  biweekly: "every two weeks",
  monthly: "per month",
  yearly: "per year",
} as const;

export type Generator = (ctx: InsightContext) => Insight[];

const merchantLink = (key: string, name: string) =>
  transactionsHref({ merchant: key, merchantName: name, type: "expense" });

/** A category up or down by more than 25% and $50 against its three-month average. */
export const categoryChanges: Generator = (ctx) => {
  const report = getSpendingReport(ctx.db, { month: ctx.month }, ctx.now, ctx.timeZone);
  const { elapsedDays, days, isCurrent } = report.range;
  // A part-way month is compared with what the average would have reached by now.
  if (isCurrent && elapsedDays < 7) return [];
  const portion = isCurrent ? elapsedDays / days : 1;
  const out: Array<{ insight: Insight; size: number }> = [];
  for (const c of report.comparison) {
    if (c.averageCents === null || c.averageCents <= 0) continue;
    const expected = Math.round(c.averageCents * portion);
    const delta = c.cents - expected;
    if (Math.abs(delta) < CATEGORY_CHANGE_MIN_CENTS || Math.abs(delta) / expected <= CATEGORY_CHANGE_PCT) continue;
    const pct = Math.round((Math.abs(delta) / expected) * 100);
    const up = delta > 0;
    out.push({
      size: Math.abs(delta),
      insight: {
        id: `category-${up ? "up" : "down"}:${c.id ?? "none"}:${ctx.month}`,
        severity: up ? "warn" : "good",
        title: `${c.name} spending is ${up ? "up" : "down"} ${pct}%`,
        body: `${$(c.cents)} ${isCurrent ? "so far this month" : "this month"}, ${$(Math.abs(delta))} ${up ? "more" : "less"} than your 3-month average${isCurrent ? " for this point in the month" : ""} (${$(expected)}).`,
        valueCents: delta,
        link: spendingHref(monthSpan(ctx.month), { categoryId: c.id ?? "none" }),
      },
    });
  }
  return out
    .sort((a, b) => b.size - a.size)
    .slice(0, 4)
    .map((x) => x.insight);
};

/** A merchant seen for the first time recently, with a purchase well above the typical one. */
export const newMerchants: Generator = (ctx) => {
  const rows = ctx.expenses();
  if (rows.length === 0 || dayNumber(ctx.today) - dayNumber(rows[0].date) < MIN_HISTORY_DAYS) return [];
  const typical = median(rows.map((r) => r.cents));
  const cutoff = addDaysToDate(ctx.today, -NEW_MERCHANT_WINDOW_DAYS);
  const first = new Map<string, TxnRow[]>();
  for (const r of rows) {
    if (!r.merchantKey || r.merchantKey === "unknown") continue;
    first.set(r.merchantKey, [...(first.get(r.merchantKey) ?? []), r]);
  }
  const out: Insight[] = [];
  for (const [key, list] of first) {
    if (list[0].date < cutoff) continue; // seen before the window
    const biggest = list.reduce((a, b) => (b.cents > a.cents ? b : a));
    if (biggest.cents <= NEW_MERCHANT_MEDIAN_MULTIPLE * typical) continue;
    const name = merchantName(ctx.db, key);
    out.push({
      id: `new-merchant:${key}`,
      severity: "info",
      title: `New merchant: ${name}`,
      body: `First seen ${list[0].date}; ${$(biggest.cents)} is more than ${NEW_MERCHANT_MEDIAN_MULTIPLE}× your typical purchase of ${$(typical)}.`,
      valueCents: biggest.cents,
      link: merchantLink(key, name),
    });
  }
  return out.sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0)).slice(0, 3);
};

/** Price increases on subscriptions, and recurring charges that were only just detected. */
export const subscriptions: Generator = (ctx) => {
  const report = detectRecurring(ctx.db, ctx.now, ctx.timeZone);
  const out: Insight[] = [];
  for (const item of report.items) {
    const link = merchantLink(item.key, item.name);
    if (item.increasePct !== null && item.previousAmountCents !== null) {
      out.push({
        id: `price-increase:${item.key}`,
        severity: "warn",
        title: `${item.name} went up ${Math.round(item.increasePct * 100)}%`,
        body: `Now ${$(item.amountCents)} ${CADENCE_PHRASE[item.cadence]}, was ${$(item.previousAmountCents)}.`,
        valueCents: item.amountCents - item.previousAmountCents,
        link,
      });
    } else if (item.count === MIN_OCCURRENCES && dayNumber(ctx.today) - dayNumber(item.lastDate) <= 35) {
      out.push({
        id: `new-recurring:${item.key}`,
        severity: "info",
        title: `New recurring charge: ${item.name}`,
        body: `${$(item.amountCents)} ${item.cadence}, about ${$(item.monthlyCostCents)} a month. Next one is expected around ${item.nextDate}.`,
        valueCents: item.monthlyCostCents,
        link,
      });
    }
  }
  return out.slice(0, 4);
};

/** A recent purchase far outside what is normal for its category. */
export const largeTransactions: Generator = (ctx) => {
  const cutoff = addDaysToDate(ctx.today, -OUTLIER_WINDOW_DAYS);
  const rows = ctx.expenses();
  const history = new Map<number | null, number[]>();
  for (const r of rows) if (r.date < cutoff) history.set(r.categoryId, [...(history.get(r.categoryId) ?? []), r.cents]);
  const out: Array<{ insight: Insight; cents: number }> = [];
  for (const r of rows) {
    if (r.date < cutoff || r.categoryId === null) continue; // uncategorized spending has no meaningful baseline
    const base = history.get(r.categoryId) ?? [];
    if (base.length < OUTLIER_MIN_SAMPLES) continue;
    const { mean, sd } = meanAndStdDev(base);
    if (r.cents < OUTLIER_MIN_CENTS || r.cents <= mean + OUTLIER_SIGMAS * sd || r.cents < 1.5 * mean) continue;
    const category = ctx.db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.id, r.categoryId))
      .get();
    out.push({
      cents: r.cents,
      insight: {
        id: `large-txn:${r.id}`,
        severity: "warn",
        title: `Unusually large ${category?.name ?? "purchase"} charge`,
        body: `${$(r.cents)} on ${r.date}, against a typical ${$(Math.round(mean))} for this category.`,
        valueCents: r.cents,
        link: transactionsHref({ from: r.date, to: r.date, categoryId: r.categoryId, type: "expense" }),
      },
    });
  }
  return out
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 3)
    .map((x) => x.insight);
};

/** Month-end projection at the current pace, against the three-month average. */
export const spendingPace: Generator = (ctx) => {
  const { month, today } = ctx;
  if (today.slice(0, 7) !== month) return [];
  const elapsed = Number(today.slice(8, 10));
  if (elapsed < PACE_MIN_DAYS) return [];
  const days = daysInMonth(month);
  const perDay = dailySpending(
    ctx.db,
    monthRange(shiftMonth(month, -3), ctx.timeZone).start,
    monthRange(month, ctx.timeZone).end,
    ctx.timeZone,
  );
  const totals = new Map<string, number>();
  for (const [date, cents] of perDay) totals.set(date.slice(0, 7), (totals.get(date.slice(0, 7)) ?? 0) + cents);
  const past = [1, 2, 3].map((n) => totals.get(shiftMonth(month, -n)) ?? 0).filter((t) => t > 0);
  if (past.length === 0) return [];
  const average = Math.round(past.reduce((s, t) => s + t, 0) / past.length);
  const spent = totals.get(month) ?? 0;
  const projected = Math.round((spent * days) / elapsed);
  const diff = (projected - average) / average;
  const pct = Math.round(Math.abs(diff) * 100);
  const severity = diff > PACE_BAND ? "warn" : diff < -PACE_BAND ? "good" : "info";
  return [
    {
      id: `pace:${month}`,
      severity,
      title: `On pace for ${$(projected)} this month`,
      body:
        pct === 0
          ? `That's right on your 3-month average of ${$(average)}.`
          : `That's ${pct}% ${diff > 0 ? "above" : "below"} your 3-month average of ${$(average)}. ${$(spent)} spent in ${elapsed} day${elapsed === 1 ? "" : "s"} so far.`,
      valueCents: projected,
      link: spendingHref(monthSpan(month)),
    },
  ];
};

/** Income that just arrived, and regular deposits whose amount changed. */
export const incomeEvents: Generator = (ctx) => {
  const rows = ctx.income().filter((r) => r.cents >= INCOME_MIN_CENTS && r.merchantKey && r.merchantKey !== "unknown");
  const byKey = new Map<string, TxnRow[]>();
  for (const r of rows) byKey.set(r.merchantKey!, [...(byKey.get(r.merchantKey!) ?? []), r]);
  const recentCutoff = addDaysToDate(ctx.today, -INCOME_RECENT_DAYS);
  const out: Insight[] = [];
  for (const [key, list] of byKey) {
    const latest = list[list.length - 1];
    if (latest.date < recentCutoff) continue;
    const before = list.slice(0, -1);
    const name = merchantName(ctx.db, key);
    const link = transactionsHref({ merchant: key, merchantName: name, type: "income" });
    const typical = before.length >= 2 ? median(before.slice(-6).map((r) => r.cents)) : null;
    if (typical !== null && Math.abs(latest.cents - typical) / typical > INCOME_CHANGE_PCT) {
      const up = latest.cents > typical;
      out.push({
        id: `income-changed:${latest.id}`,
        severity: up ? "good" : "warn",
        title: `${name} deposit ${up ? "increased" : "decreased"}`,
        body: `${$(latest.cents)} on ${latest.date}, compared with a usual ${$(Math.round(typical))}.`,
        valueCents: latest.cents - Math.round(typical),
        link,
      });
    } else {
      out.push({
        id: `income-arrived:${latest.id}`,
        severity: "good",
        title: `Income arrived from ${name}`,
        body: `${$(latest.cents)} on ${latest.date}.`,
        valueCents: latest.cents,
        link,
      });
    }
  }
  return out.slice(0, 3);
};

/** The same merchant charging the same amount twice within 48 hours. */
export const duplicateCharges: Generator = (ctx) => {
  const cutoff = ctx.now - DUPLICATE_LOOKBACK_DAYS * 86_400;
  const rows = ctx
    .expenses()
    .filter((r) => r.at >= cutoff && r.merchantKey && r.merchantKey !== "unknown" && r.cents >= 100);
  const out: Insight[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (b.at - a.at > DUPLICATE_WINDOW_SECONDS) break; // rows are sorted by time
      if (a.merchantKey !== b.merchantKey || a.cents !== b.cents || seen.has(a.id) || seen.has(b.id)) continue;
      seen.add(a.id).add(b.id);
      const name = merchantName(ctx.db, a.merchantKey!);
      out.push({
        id: `duplicate:${a.id}:${b.id}`,
        severity: "warn",
        title: `Possible duplicate charge at ${name}`,
        body: `${$(a.cents)} on ${a.date}${a.date === b.date ? " twice" : ` and again on ${b.date}`}. Worth checking it wasn't charged by mistake.`,
        valueCents: a.cents,
        link: transactionsHref({
          from: a.date,
          to: b.date,
          merchant: a.merchantKey!,
          merchantName: name,
          type: "expense",
        }),
      });
    }
  }
  return out.slice(0, 3);
};

/** Accounts under their low-balance alert, and credit cards using a large share of their limit. */
export const balanceAlerts: Generator = (ctx) => {
  const out: Insight[] = [];
  for (const a of ctx.db.select().from(accounts).all()) {
    if (a.isHidden || a.isClosed) continue;
    const label = a.displayName || a.name;
    const link = `/accounts/${encodeURIComponent(a.id)}`;
    if (a.type === "credit") {
      if (!a.creditLimitCents || a.balanceCents >= 0) continue;
      const used = -a.balanceCents;
      const utilization = used / a.creditLimitCents;
      if (utilization < UTILIZATION_INFO) continue;
      out.push({
        id: `utilization:${a.id}`,
        severity: utilization >= UTILIZATION_WARN ? "warn" : "info",
        title: `${label} is at ${Math.round(utilization * 100)}% of its limit`,
        body: `${$(used)} owed of a ${$(a.creditLimitCents)} limit. Staying under ${Math.round(UTILIZATION_INFO * 100)}% is easier on your credit score.`,
        valueCents: used,
        link,
      });
    } else if (a.lowBalanceCents !== null && a.balanceCents < a.lowBalanceCents) {
      out.push({
        id: `low-balance:${a.id}`,
        severity: "warn",
        title: `${label} is running low`,
        body: `Balance is ${$(a.balanceCents)}, under your ${$(a.lowBalanceCents)} alert level.`,
        valueCents: a.balanceCents,
        link,
      });
    }
  }
  return out;
};

/** A nudge when recent spending has piled up without a category. */
export const uncategorizedReminder: Generator = (ctx) => {
  const since = ctx.now - 90 * 86_400;
  const n =
    ctx.db
      .select({ n: count() })
      .from(transactions)
      .where(
        and(
          sql`${transactions.categoryId} IS NULL`,
          eq(transactions.isTransfer, false),
          eq(transactions.isExcluded, false),
          sql`${transactions.amountCents} < 0`,
          gte(transactions.posted, since),
        ),
      )
      .get()?.n ?? 0;
  if (n < UNCATEGORIZED_MIN) return [];
  return [
    {
      id: "uncategorized",
      severity: "info",
      title: `${n} purchases need a category`,
      body: "Categorizing them (or adding a rule) makes your spending charts and targets more accurate.",
      link: transactionsHref({
        categoryId: "none",
        type: "expense",
        from: addDaysToDate(ctx.today, -90),
        to: ctx.today,
      }),
    },
  ];
};

export const GENERATORS: Generator[] = [
  duplicateCharges,
  balanceAlerts,
  subscriptions,
  largeTransactions,
  categoryChanges,
  spendingPace,
  incomeEvents,
  newMerchants,
  uncategorizedReminder,
];
