import { displayPayee, type TagChip, type TransactionRow } from "@/lib/finance/transaction-types";
import type { BulkPatchInput, TransactionPatchInput } from "@/lib/finance/transaction-schemas";

const blankToNull = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

/** Mirrors the server's update rules on a cached row, for optimistic UI. */
export function applyPatchToRow(
  row: TransactionRow,
  patch: TransactionPatchInput,
  tagsById: Map<number, TagChip>,
): TransactionRow {
  const next = { ...row };
  if (patch.categoryId !== undefined) next.categoryId = patch.categoryId;
  if (patch.notes !== undefined) next.notes = blankToNull(patch.notes);
  if (patch.payeeOverride !== undefined) next.payeeOverride = blankToNull(patch.payeeOverride);
  if (patch.isExcluded !== undefined) next.isExcluded = patch.isExcluded;
  if (patch.isReviewed !== undefined) next.isReviewed = patch.isReviewed;
  if (patch.isTransfer !== undefined) {
    next.isTransfer = patch.isTransfer;
    if (!patch.isTransfer) next.transferPairId = null;
  }
  if (patch.tagIds !== undefined) {
    next.tags = [...new Set(patch.tagIds)]
      .flatMap((id) => tagsById.get(id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  next.displayPayee = displayPayee(next);
  return next;
}

export function applyBulkPatchToRow(
  row: TransactionRow,
  patch: BulkPatchInput["patch"],
  tagsById: Map<number, TagChip>,
): TransactionRow {
  const next = { ...row };
  if (patch.categoryId !== undefined) next.categoryId = patch.categoryId;
  if (patch.isExcluded !== undefined) next.isExcluded = patch.isExcluded;
  if (patch.isReviewed !== undefined) next.isReviewed = patch.isReviewed;
  if (patch.addTagIds?.length || patch.removeTagIds?.length) {
    const ids = new Set(next.tags.map((t) => t.id));
    patch.addTagIds?.forEach((id) => ids.add(id));
    patch.removeTagIds?.forEach((id) => ids.delete(id));
    next.tags = [...ids].flatMap((id) => tagsById.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
  }
  return next;
}
