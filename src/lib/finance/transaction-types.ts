// Client-safe types shared by the transactions API and the register UI (no server imports).

export interface TagChip {
  id: number;
  name: string;
  color: string;
}

export interface TransactionRow {
  id: number;
  accountId: string;
  accountName: string;
  currency: string;
  /** Pending items use their purchase date; posted items use the posted date. Unix seconds. */
  effectiveDate: number;
  posted: number;
  transactedAt: number | null;
  pending: boolean;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
  payeeOverride: string | null;
  /** Override, else bank payee, else description. */
  displayPayee: string;
  categoryId: number | null;
  notes: string | null;
  isTransfer: boolean;
  transferPairId: number | null;
  isExcluded: boolean;
  isReviewed: boolean;
  tags: TagChip[];
  /** Balance after this transaction; only for unfiltered single-account views. */
  runningBalanceCents: number | null;
}

export type TransactionTypeFilter = "expense" | "income" | "transfer";
export type TransactionStatusFilter = "pending" | "unreviewed" | "reviewed";

export interface TransactionFilters {
  accountId?: string;
  q?: string;
  /** Inclusive local dates, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  /** A category id, or "none" for uncategorized. */
  categoryId?: number | "none";
  tagId?: number;
  /** Bounds on the absolute amount, in cents. */
  minAmountCents?: number;
  maxAmountCents?: number;
  type?: TransactionTypeFilter;
  status?: TransactionStatusFilter;
}

export interface TransactionPage {
  rows: TransactionRow[];
  nextCursor: string | null;
  /** Number of matching transactions; only present on the first page. */
  total?: number;
}

export interface TransactionDetail extends TransactionRow {
  rawJson: string;
  importedAt: number;
  pair: Pick<
    TransactionRow,
    "id" | "accountName" | "displayPayee" | "amountCents" | "currency" | "effectiveDate"
  > | null;
}

/** Override, else bank payee, else description. */
export function displayPayee(r: Pick<TransactionRow, "payeeOverride" | "payee" | "description">): string {
  return r.payeeOverride?.trim() || r.payee?.trim() || r.description;
}
