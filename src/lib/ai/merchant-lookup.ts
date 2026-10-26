import "server-only";
import type { DbLike } from "@/db/open";
import { normalizePayee, payeeKey } from "@/lib/finance/payee";
import { queryTransactions } from "@/lib/finance/transactions-query";

export interface MerchantGroup {
  /** `<direction>:<payeeKey>`, the same shape the suggestion job uses. */
  key: string;
  name: string;
  /** One raw bank description (shown to the owner only, never sent to a model). */
  sample: string;
  income: boolean;
  /** Absolute amounts, oldest to newest is not guaranteed. */
  amounts: number[];
  /** The most recent matching transaction. */
  latestId: number;
}

/** The biggest group of transactions whose payee matches `query`, or undefined when nothing matches. */
export function findMerchantGroup(db: DbLike, query: string, timeZone: string): MerchantGroup | undefined {
  const rows = queryTransactions(db, { q: query }, { limit: 200, timeZone }).rows; // newest first
  const groups = new Map<string, MerchantGroup>();
  for (const r of rows) {
    const display = normalizePayee(r.displayPayee) || r.displayPayee;
    const income = r.amountCents > 0;
    const key = `${income ? "income" : "expense"}:${payeeKey(display) || "unknown"}`;
    const g = groups.get(key) ?? { key, name: display, sample: r.description, income, amounts: [], latestId: r.id };
    g.amounts.push(Math.abs(r.amountCents));
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.amounts.length - a.amounts.length)[0];
}
