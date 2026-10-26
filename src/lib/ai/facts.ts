import "server-only";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiProposals, transactions } from "@/db/schema";
import { transactionsHref } from "@/components/spending/links";
import { formatCents } from "@/lib/finance/cents";
import { addDaysToDate, localDateString, shiftMonth } from "@/lib/finance/dates";
import { upcomingCharges } from "@/lib/finance/recurring";
import { merchantName } from "@/lib/finance/spending-report";
import { getSpendingReport } from "@/lib/finance/spending-report";
import { noSplitsSql } from "@/lib/finance/sql";
import { listGoalProgress } from "@/lib/finance/goals";
import { getTargetProgress } from "@/lib/finance/targets";
import { getInsights } from "@/lib/insights";
import { createContext } from "@/lib/insights/data";
import type { InsightContext } from "@/lib/insights/data";
import { SEVERITY_ORDER } from "@/lib/insights/types";
import type { LensId } from "./lenses";

// Facts are computed observations with stable ids. The model never invents them: it picks and phrases them, and
// the server attaches links from the ids it owns.

const $ = (cents: number) => formatCents(cents, { hideZeroCents: true });

export const MAX_FACTS = 40;
export const MERCHANT_GROWTH_FACTOR = 1.5;
export const MERCHANT_GROWTH_MIN_CENTS = 50_00;
export const SAVINGS_RATE_POINTS = 0.05;

export interface Fact {
  /** Stable, e.g. "stale-manual:acct-3", "merchant-up:traderjoes:2026-10". */
  id: string;
  lenses: LensId[];
  severity: "info" | "good" | "warn";
  /** Full wording; may contain an account name. */
  title: string;
  detail: string;
  /** Wording without account names or balances, for the model when `includeBalances` is off. */
  redacted?: { title: string; detail: string };
  sensitive: boolean;
  /** Built here from ids we own, never from model output. */
  link?: string;
  /** Where public data came from (https links the provider cited), for benchmark facts only. */
  sources?: Array<{ url: string; title?: string }>;
}

export interface FactEnv {
  now: number;
  timeZone: string;
  includeBalances: boolean;
}

// ── 1. the existing deterministic insights ──────────────────────────────────

const INSIGHT_LENSES: Array<[prefix: string, lenses: LensId[]]> = [
  ["category-", ["spending"]],
  ["pace", ["spending", "cashflow"]],
  ["large-txn", ["spending"]],
  ["new-merchant", ["spending"]],
  ["price-increase", ["subscriptions"]],
  ["new-recurring", ["subscriptions"]],
  ["income-", ["cashflow"]],
  ["duplicate", ["cleanup"]],
  ["uncategorized", ["cleanup"]],
  ["low-balance", ["accounts"]],
  ["utilization", ["accounts"]],
  ["stale-manual", ["accounts"]],
];

const REDACTED_INSIGHTS: Array<[prefix: string, title: (t: string) => string, detail: string]> = [
  ["low-balance", () => "An account is running low", "One of your accounts is under its low-balance alert level."],
  [
    "utilization",
    () => "A credit card is using a large share of its limit",
    "One of your cards is close to its limit.",
  ],
  [
    "stale-manual",
    (t) =>
      t.replace(/^You haven't updated .+ in (\d+) days$/, "One of your manual accounts hasn't been updated in $1 days"),
    "A manual account's balance is probably out of date.",
  ],
];

export function factsFromInsights(db: DbLike, env: FactEnv): Fact[] {
  const out: Fact[] = [];
  for (const i of getInsights(db, { now: env.now, timeZone: env.timeZone }).insights) {
    const lenses = INSIGHT_LENSES.find(([p]) => i.id.startsWith(p))?.[1];
    if (!lenses) continue;
    const redaction = REDACTED_INSIGHTS.find(([p]) => i.id.startsWith(p));
    out.push({
      id: i.id,
      lenses,
      severity: i.severity,
      title: i.title,
      detail: i.body,
      sensitive: !!redaction,
      redacted: redaction ? { title: redaction[1](i.title), detail: redaction[2] } : undefined,
      link: i.link,
    });
  }
  return out;
}

// ── 3. merchant growth ──────────────────────────────────────────────────────

/** Merchants whose last-30-day spend is ≥ 1.5× their usual 30 days (average of the 180 before) and ≥ $50 more. */
export function merchantGrowthFacts(ctx: InsightContext): Fact[] {
  const recentFrom = ctx.now - 30 * 86_400;
  const baseFrom = ctx.now - 210 * 86_400;
  const recent = new Map<string, number>();
  const base = new Map<string, number>();
  for (const r of ctx.expenses()) {
    if (!r.merchantKey || r.merchantKey === "unknown") continue;
    if (r.at >= recentFrom) recent.set(r.merchantKey, (recent.get(r.merchantKey) ?? 0) + r.cents);
    else if (r.at >= baseFrom) base.set(r.merchantKey, (base.get(r.merchantKey) ?? 0) + r.cents);
  }
  const month = ctx.today.slice(0, 7);
  return [...recent.entries()]
    .flatMap(([key, now30]) => {
      const usual = (base.get(key) ?? 0) / 6;
      return usual > 0 && now30 >= MERCHANT_GROWTH_FACTOR * usual && now30 - usual >= MERCHANT_GROWTH_MIN_CENTS
        ? [{ key, now30, usual }]
        : [];
    })
    .sort((a, b) => b.now30 - b.usual - (a.now30 - a.usual))
    .slice(0, 3)
    .map(({ key, now30, usual }): Fact => {
      const name = merchantName(ctx.db, key);
      return {
        id: `merchant-up:${key}:${month}`,
        lenses: ["spending"],
        severity: "info",
        title: `${name} is up this month`,
        detail: `${$(now30)} in the last 30 days against about ${$(Math.round(usual))} in a typical 30 days.`,
        sensitive: false,
        link: transactionsHref({ merchant: key, merchantName: name, type: "expense" }),
      };
    });
}

// ── 4-5. subscriptions and upcoming bills ───────────────────────────────────

export function subscriptionFacts(ctx: InsightContext): Fact[] {
  const report = ctx.recurring();
  if (report.items.length === 0) return [];
  const biggest = report.items.reduce((a, b) => (b.monthlyCostCents > a.monthlyCostCents ? b : a));
  return [
    {
      id: "subscriptions-total",
      lenses: ["subscriptions"],
      severity: "info",
      title: `${report.items.length} recurring charges cost ${$(report.monthlyTotalCents)} a month`,
      detail: `That is ${$(report.yearlyTotalCents)} a year. The biggest is ${biggest.name} at ${$(biggest.monthlyCostCents)} a month.`,
      sensitive: false,
      link: "/forecast",
    },
  ];
}

export function upcomingBillFacts(ctx: InsightContext): Fact[] {
  const soon = upcomingCharges(ctx.recurring(), ctx.today, 7, 5);
  if (soon.length === 0) return [];
  const total = soon.reduce((s, c) => s + c.amountCents, 0);
  return [
    {
      id: `upcoming-bills:${ctx.today}`,
      lenses: ["cashflow"],
      severity: "info",
      title: `${soon.length} bill${soon.length === 1 ? "" : "s"} due in the next 7 days (${$(total)})`,
      detail: soon.map((c) => `${c.name} ${$(c.amountCents)} on ${c.nextDate}`).join("; "),
      sensitive: false,
      link: "/forecast",
    },
  ];
}

// ── 6. savings rate ─────────────────────────────────────────────────────────

export function savingsRateFacts(db: DbLike, env: FactEnv): Fact[] {
  const month = localDateString(env.now, env.timeZone).slice(0, 7);
  const window = (fromShift: number) => ({
    from: `${shiftMonth(month, fromShift)}-01`,
    to: addDaysToDate(`${shiftMonth(month, fromShift + 3)}-01`, -1),
  });
  const rate = (w: { from: string; to: string }) => getSpendingReport(db, w, env.now, env.timeZone).summary.savingsRate;
  const recent = rate(window(-3));
  const before = rate(window(-6));
  if (recent === null || before === null) return [];
  const diff = recent - before;
  if (Math.abs(diff) < SAVINGS_RATE_POINTS) return [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return [
    {
      id: `savings-rate:${month}`,
      lenses: ["cashflow"],
      severity: diff > 0 ? "good" : "warn",
      title: `Your savings rate ${diff > 0 ? "improved" : "slipped"} to ${pct(recent)}`,
      detail: `Over the last 3 full months you saved ${pct(recent)} of income, against ${pct(before)} in the 3 months before.`,
      sensitive: false,
      link: "/spending",
    },
  ];
}

// ── 7. targets ──────────────────────────────────────────────────────────────

export function targetFacts(db: DbLike, env: FactEnv): Fact[] {
  const month = localDateString(env.now, env.timeZone).slice(0, 7);
  return getTargetProgress(db, month, env.now, env.timeZone).flatMap((t): Fact[] => {
    if (t.fraction >= 1)
      return [
        {
          id: `target-over:${t.id}:${month}`,
          lenses: ["spending"],
          severity: "warn",
          title: `${t.name} is over its target`,
          detail: `${$(t.spentCents)} spent against a ${$(t.amountCents)} target this month.`,
          sensitive: false,
          link: "/spending",
        },
      ];
    if (t.onPaceToExceed && t.projectedCents !== null)
      return [
        {
          id: `target-pace:${t.id}:${month}`,
          lenses: ["spending"],
          severity: "info",
          title: `${t.name} is on pace to pass its target`,
          detail: `${$(t.spentCents)} so far; about ${$(t.projectedCents)} by month end against a ${$(t.amountCents)} target.`,
          sensitive: false,
          link: "/spending",
        },
      ];
    return [];
  });
}

// ── 8. goals ────────────────────────────────────────────────────────────────

export function goalFacts(db: DbLike, env: FactEnv): Fact[] {
  return listGoalProgress(db, env.now, env.timeZone).flatMap((g): Fact[] => {
    if (g.status === "done")
      return [
        {
          id: `goal-done:${g.id}`,
          lenses: ["goals"],
          severity: "good",
          title: `You reached your goal "${g.name}"`,
          detail: `The target of ${$(g.targetCents)} has been reached.`,
          sensitive: true,
          redacted: { title: `You reached your goal "${g.name}"`, detail: "The target has been reached." },
          link: "/goals",
        },
      ];
    if (g.status === "behind")
      return [
        {
          id: `goal-behind:${g.id}`,
          lenses: ["goals"],
          severity: "warn",
          title: `"${g.name}" is behind schedule`,
          detail: `${$(g.savedCents)} of ${$(g.targetCents)} saved; ${g.neededPerMonthCents !== null ? `${$(g.neededPerMonthCents)} a month is needed to finish by ${g.targetDate}` : "it needs to speed up"}.`,
          sensitive: true,
          redacted: {
            title: `"${g.name}" is behind schedule`,
            detail: "At the current pace it won't reach its target date.",
          },
          link: "/goals",
        },
      ];
    return [];
  });
}

// ── 9. rules coverage ───────────────────────────────────────────────────────

export function rulesCoverageFacts(db: DbLike, env: FactEnv): Fact[] {
  const since = env.now - 90 * 86_400;
  const eligible = and(
    eq(transactions.isTransfer, false),
    eq(transactions.isExcluded, false),
    gte(transactions.posted, since),
  );
  const total = db.select({ n: count() }).from(transactions).where(eligible).get()?.n ?? 0;
  const uncategorized =
    db
      .select({ n: count() })
      .from(transactions)
      .where(and(eligible, sql`${transactions.categoryId} IS NULL`, noSplitsSql))
      .get()?.n ?? 0;
  const pending =
    db
      .select({ n: count() })
      .from(aiProposals)
      .where(and(eq(aiProposals.kind, "rule"), eq(aiProposals.status, "pending")))
      .get()?.n ?? 0;
  if (total === 0 || (uncategorized === 0 && pending === 0)) return [];
  return [
    {
      id: "rules-coverage",
      lenses: ["cleanup"],
      severity: "info",
      title: `${Math.round(((total - uncategorized) / total) * 100)}% of recent transactions are categorized`,
      detail: `${uncategorized} of the last 90 days' transactions still need a category${pending ? `, and ${pending} rule suggestion${pending === 1 ? " is" : "s are"} waiting` : ""}.`,
      sensitive: false,
      link: "/rules",
    },
  ];
}

// ── assembling ──────────────────────────────────────────────────────────────

/** Every fact worth talking about, warnings first, at most 40. A source that throws is skipped. */
export function collectFacts(db: DbLike, env: FactEnv): Fact[] {
  const month = localDateString(env.now, env.timeZone).slice(0, 7);
  const ctx = createContext(db, env.now, env.timeZone, month);
  const sources: Array<() => Fact[]> = [
    () => factsFromInsights(db, env),
    () => merchantGrowthFacts(ctx),
    () => subscriptionFacts(ctx),
    () => upcomingBillFacts(ctx),
    () => savingsRateFacts(db, env),
    () => targetFacts(db, env),
    () => goalFacts(db, env),
    () => rulesCoverageFacts(db, env),
  ];
  const facts: Fact[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    try {
      for (const f of source()) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        facts.push(f);
      }
    } catch {
      // One failing source must not take the assistant down.
    }
  }
  return facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .slice(0, MAX_FACTS)
    .map((x) => x.f);
}

/** What the model may see: sensitive facts use their redacted wording unless balances are shared (or are dropped). */
export function factsForModel(
  facts: Fact[],
  includeBalances: boolean,
): Array<{ id: string; severity: Fact["severity"]; title: string; detail: string }> {
  return facts.flatMap((f) => {
    if (f.sensitive && !includeBalances) {
      return f.redacted ? [{ id: f.id, severity: f.severity, ...f.redacted }] : [];
    }
    return [{ id: f.id, severity: f.severity, title: f.title, detail: f.detail }];
  });
}

export const factsForLens = (facts: Fact[], lens: LensId | "all") =>
  lens === "all" || lens === "general" ? facts : facts.filter((f) => f.lenses.includes(lens));
