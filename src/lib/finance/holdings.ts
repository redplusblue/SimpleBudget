import { eq } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { accounts, holdings } from "@/db/schema";

export interface HoldingRow {
  id: number;
  symbol: string;
  description: string;
  /** Decimal string as reported. */
  shares: string;
  marketValueCents: number;
  costBasisCents: number | null;
  currency: string;
  /** Market value minus cost basis, when the cost is known. */
  gainCents: number | null;
  /** gain / cost basis, when the cost is known and non-zero. */
  gainPct: number | null;
  /** Share of the account's holdings by market value (0-1). */
  weight: number;
}

export interface HoldingsSummary {
  holdings: HoldingRow[];
  totalValueCents: number;
  /** Cost basis of the positions that report one, with the value of those same positions. */
  knownCostCents: number;
  knownValueCents: number;
  totalGainCents: number | null;
  totalGainPct: number | null;
  /** Newest `updated_at` among the rows, for "as of". */
  asOf: number | null;
}

/** Positions in one account, largest first, with gain or loss and portfolio weight. Empty when the bank reports none. */
export function getHoldings(db: DbLike, accountId: string): HoldingsSummary {
  const rows = db.select().from(holdings).where(eq(holdings.accountId, accountId)).all();
  const total = rows.reduce((s, r) => s + r.marketValueCents, 0);
  const mapped = rows
    .map((r): HoldingRow => {
      const gain = r.costBasisCents === null ? null : r.marketValueCents - r.costBasisCents;
      return {
        id: r.id,
        symbol: r.symbol,
        description: r.description,
        shares: r.shares,
        marketValueCents: r.marketValueCents,
        costBasisCents: r.costBasisCents,
        currency: r.currency,
        gainCents: gain,
        gainPct: gain === null || !r.costBasisCents ? null : gain / r.costBasisCents,
        weight: total === 0 ? 0 : r.marketValueCents / total,
      };
    })
    .sort((a, b) => b.marketValueCents - a.marketValueCents || a.symbol.localeCompare(b.symbol));
  const withCost = mapped.filter((r) => r.costBasisCents !== null);
  const knownCostCents = withCost.reduce((s, r) => s + (r.costBasisCents ?? 0), 0);
  const knownValueCents = withCost.reduce((s, r) => s + r.marketValueCents, 0);
  return {
    holdings: mapped,
    totalValueCents: total,
    knownCostCents,
    knownValueCents,
    totalGainCents: withCost.length ? knownValueCents - knownCostCents : null,
    totalGainPct: withCost.length && knownCostCents ? (knownValueCents - knownCostCents) / knownCostCents : null,
    asOf: rows.length ? Math.max(...rows.map((r) => r.updatedAt)) : null,
  };
}

/** Accounts that currently have holdings (for deciding where to show the section). */
export function accountsWithHoldings(db: DbLike): string[] {
  return [
    ...new Set(
      db
        .select({ id: holdings.accountId })
        .from(holdings)
        .innerJoin(accounts, eq(accounts.id, holdings.accountId))
        .all()
        .map((r) => r.id),
    ),
  ];
}
