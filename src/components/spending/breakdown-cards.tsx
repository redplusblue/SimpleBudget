import Link from "next/link";
import { Money } from "@/components/money";
import { formatCents } from "@/lib/finance/cents";
import type {
  AccountBreakdownRow,
  MerchantRow,
  ReportRange,
  TagBreakdownRow,
} from "@/lib/finance/spending-report-types";
import { spendingHref } from "./links";
import { RankedBars } from "./ranked-bars";
import { EmptyNote, Section } from "./section";

const spanOf = (range: ReportRange) => ({ from: range.from, to: range.to });

export function TagsCard({ range, rows }: { range: ReportRange; rows: TagBreakdownRow[] }) {
  return (
    <Section id="tags" title="By tag" description="A purchase can have several tags, so these totals may overlap.">
      {rows.length === 0 ? (
        <EmptyNote>No tagged purchases in this range. Tags are optional; add them from a transaction.</EmptyNote>
      ) : (
        <RankedBars
          testId="tag-list"
          rows={rows.map((t) => ({
            key: String(t.id),
            name: t.name,
            color: t.color,
            cents: t.cents,
            count: t.count,
            href: spendingHref(spanOf(range), { tagId: t.id }),
          }))}
        />
      )}
    </Section>
  );
}

export function AccountsCard({ range, rows }: { range: ReportRange; rows: AccountBreakdownRow[] }) {
  return (
    <Section id="accounts" title="By account" description="Where the spending happened.">
      {rows.length === 0 ? (
        <EmptyNote>No spending in this range.</EmptyNote>
      ) : (
        <RankedBars
          testId="account-list"
          rows={rows.map((a) => ({
            key: a.id,
            name: a.name,
            color: a.color,
            cents: a.cents,
            count: a.count,
            note: `${(a.share * 100).toFixed(0)}%`,
            href: spendingHref(spanOf(range), { accountId: a.id }),
          }))}
        />
      )}
    </Section>
  );
}

export function MerchantsCard({ range, rows }: { range: ReportRange; rows: MerchantRow[] }) {
  return (
    <Section
      id="merchants"
      title="Top merchants"
      description="Grouped by cleaned-up name, so “TRADER JOE'S #552 AUSTIN TX” and “Trader Joe's” count together."
    >
      {rows.length === 0 ? (
        <EmptyNote>No purchases in this range.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm" data-testid="merchant-table">
            <caption className="sr-only">Top merchants by spending</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 text-left font-normal">
                  Merchant
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Purchases
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Average
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.key} className="border-t border-border/60">
                  <td className="py-1">
                    <Link
                      href={spendingHref(spanOf(range), { merchant: m.key, merchantName: m.name })}
                      className="flex min-h-11 items-center gap-2 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                      title={`${m.name}: ${formatCents(m.cents)}`}
                    >
                      <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="truncate">{m.name}</span>
                    </Link>
                  </td>
                  <td className="py-1 text-right text-muted-foreground tabular-nums">{m.count}</td>
                  <td className="py-1 text-right text-muted-foreground">
                    <Money cents={m.avgCents} />
                  </td>
                  <td className="py-1 text-right font-medium">
                    <Money cents={m.cents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
