import { filtersToSearchParams } from "@/lib/finance/transaction-params";
import type { TransactionFilters } from "@/lib/finance/transaction-types";
import { daysInMonth } from "@/lib/finance/dates";

/** The register, opened with `filters` pre-applied (the register reads filters from the address). */
export function transactionsHref(filters: TransactionFilters): string {
  const qs = filtersToSearchParams(filters).toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}

export interface DateSpan {
  from: string;
  to: string;
}

/** The first and last day of a `YYYY-MM` month. */
export const monthSpan = (month: string): DateSpan => ({
  from: `${month}-01`,
  to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
});

/** Spending in `span`, narrowed by `extra`. Expenses are the default because every spending number is about them. */
export function spendingHref(span: DateSpan, extra: Partial<TransactionFilters> = {}): string {
  return transactionsHref({ from: span.from, to: span.to, type: "expense", ...extra });
}

export const incomeHref = (span: DateSpan) => transactionsHref({ from: span.from, to: span.to, type: "income" });
