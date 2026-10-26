import { formatCents } from "@/lib/finance/cents";
import type { TraceReport } from "@/lib/finance/trace-types";

const $ = (cents: number) => formatCents(cents);

/**
 * The trace as the model sees it: formatted figures, dates and counts. No ids, no account names, no raw bank
 * description, no notes or memos, and rule names are reduced to whether a rule exists.
 */
export function traceForModel(t: TraceReport) {
  const s = t.stats;
  const p = t.position;
  return {
    merchant: t.merchant.name,
    history: {
      transactions: s.count,
      firstDate: s.firstDate,
      lastDate: s.lastDate,
      totalSpent: $(s.totalSpentCents),
      totalReceived: $(s.totalReceivedCents),
      typicalCharge: $(s.medianCents),
      range: `${$(s.minCents)} to ${$(s.maxCents)}`,
      last12MonthsSpent: $(s.last12MonthsSpentCents),
      averagePerActiveMonth: $(s.averageMonthlyCents),
    },
    thisCharge: {
      largerThanPercentOfCharges: p.percentile,
      differenceFromTypicalPercent: p.vsMedianPct,
      isLargest: p.isLargest,
      isFirst: p.isFirst,
    },
    cadence: t.cadence ? { repeats: t.cadence.cadence, nextExpected: t.cadence.nextExpected } : null,
    priceChanges: t.priceChanges.map((c) => ({ date: c.date, from: $(c.fromCents), to: $(c.toCents) })),
    byMonth: t.byMonth.slice(0, 12).map((m) => ({ month: m.month, spent: $(m.spentCents), charges: m.count })),
    refunds: t.related.refunds.map((r) => ({ date: r.date, amount: $(r.amountCents) })),
    possibleDuplicates: t.related.possibleDuplicates.map((r) => ({ date: r.date, amount: $(r.amountCents) })),
    isTransfer: t.related.transferPair !== null,
    similarMerchants: t.similarMerchants.map((m) => ({ name: m.name, transactions: m.count })),
    categories: t.categories,
    aRuleCoversThisMerchant: t.rule !== null,
  };
}
