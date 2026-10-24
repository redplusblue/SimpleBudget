import { parseCents } from "@/lib/finance/cents";
import type { SfAccount, SfTransaction } from "./schemas";

export interface ParsedTransaction {
  sfTxnId: string;
  posted: number;
  transactedAt: number | null;
  pending: boolean;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
  rawJson: string;
}

export interface ParsedAccount {
  id: string;
  orgName: string;
  orgDomain: string | null;
  orgSfinUrl: string | null;
  name: string;
  currency: string;
  balanceCents: number;
  availableCents: number | null;
  balanceDate: number | null;
  /** `undefined` when the response carried no transaction list (e.g. balances-only). */
  transactions: ParsedTransaction[] | undefined;
}

export function parseTransaction(t: SfTransaction): ParsedTransaction {
  // SimpleFIN marks pending items with `pending: true` and/or `posted: 0`.
  const pending = t.pending === true || t.posted === 0;
  return {
    sfTxnId: t.id,
    posted: t.posted,
    transactedAt: t.transacted_at ?? null,
    pending,
    amountCents: parseCents(t.amount),
    description: t.description,
    payee: t.payee ?? null,
    memo: t.memo ?? null,
    rawJson: JSON.stringify(t),
  };
}

export function parseAccount(a: SfAccount): ParsedAccount {
  const availableRaw = a["available-balance"];
  return {
    id: a.id,
    orgName: a.org.name?.trim() || a.org.domain?.trim() || "Unknown institution",
    orgDomain: a.org.domain ?? null,
    orgSfinUrl: a.org["sfin-url"] ?? null,
    name: a.name,
    currency: a.currency,
    balanceCents: parseCents(a.balance),
    availableCents: availableRaw == null || availableRaw === "" ? null : parseCents(availableRaw),
    balanceDate: a["balance-date"] ?? null,
    transactions: a.transactions?.map(parseTransaction),
  };
}
