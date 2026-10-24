import { format, isSameDay, isSameYear, subDays } from "date-fns";
import type { TransactionRow } from "@/lib/finance/transaction-types";

export type ListItem = { kind: "header"; key: string; label: string } | { kind: "row"; row: TransactionRow };

export function dateLabel(unixSeconds: number, now: Date = new Date()): string {
  const d = new Date(unixSeconds * 1000);
  if (isSameDay(d, now)) return "Today";
  if (isSameDay(d, subDays(now, 1))) return "Yesterday";
  return format(d, isSameYear(d, now) ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

/**
 * Flattens rows into a list with a header before each run of the same day. Rows arrive newest first
 * with pending items on top, so pending gets its own "Pending" header.
 */
export function groupRows(rows: TransactionRow[], now: Date = new Date()): ListItem[] {
  const items: ListItem[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const key = row.pending ? "pending" : format(new Date(row.effectiveDate * 1000), "yyyy-MM-dd");
    if (key !== lastKey) {
      items.push({ kind: "header", key, label: row.pending ? "Pending" : dateLabel(row.effectiveDate, now) });
      lastKey = key;
    }
    items.push({ kind: "row", row });
  }
  return items;
}

/** The header label that applies at `index` (walks back to the nearest header). */
export function headerAt(items: ListItem[], index: number): string | null {
  for (let i = Math.min(index, items.length - 1); i >= 0; i--) {
    const item = items[i];
    if (item.kind === "header") return item.label;
  }
  return null;
}
