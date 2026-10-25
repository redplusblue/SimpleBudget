import { describe, expect, it } from "vitest";
import { applyBulkPatchToRow, applyPatchToRow } from "@/components/register/apply-patch";
import { dateLabel, groupRows, headerAt } from "@/components/register/group";
import type { TagChip, TransactionRow } from "@/lib/finance/transaction-types";

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: 1,
  accountId: "a",
  accountName: "A",
  currency: "USD",
  effectiveDate: 1_760_000_000,
  posted: 1_760_000_000,
  transactedAt: null,
  pending: false,
  amountCents: -500,
  description: "DESC",
  payee: "Bank Payee",
  memo: null,
  payeeOverride: null,
  displayPayee: "Bank Payee",
  categoryId: null,
  splitCount: 0,
  source: "simplefin",
  notes: null,
  isTransfer: false,
  transferPairId: null,
  isExcluded: false,
  isReviewed: false,
  tags: [],
  runningBalanceCents: null,
  ...over,
});

const tagList: TagChip[] = [
  { id: 1, name: "b-tag", color: "#111" },
  { id: 2, name: "a-tag", color: "#222" },
  { id: 3, name: "c-tag", color: "#333" },
];
const tagsById = new Map(tagList.map((t) => [t.id, t]));

describe("groupRows", () => {
  const noon = (iso: string) => new Date(iso).getTime() / 1000;
  const NOW = new Date("2026-10-28T15:00:00");

  it("puts a header before each day and a Pending header first", () => {
    const rows = [
      row({ id: 1, pending: true, effectiveDate: noon("2026-10-24T09:00:00") }),
      row({ id: 2, effectiveDate: noon("2026-10-24T09:00:00") }),
      row({ id: 3, effectiveDate: noon("2026-10-24T08:00:00") }),
      row({ id: 4, effectiveDate: noon("2026-10-23T12:00:00") }),
      row({ id: 5, effectiveDate: noon("2025-01-02T12:00:00") }),
    ];
    const items = groupRows(rows, NOW);
    expect(items.map((i) => (i.kind === "header" ? `H:${i.key}` : `R:${i.row.id}`))).toEqual([
      "H:pending",
      "R:1",
      "H:2026-10-24",
      "R:2",
      "R:3",
      "H:2026-10-23",
      "R:4",
      "H:2025-01-02",
      "R:5",
    ]);
    const labels = items.flatMap((i) => (i.kind === "header" ? [i.label] : []));
    expect(labels).toEqual(["Pending", "Sat, Oct 24", "Fri, Oct 23", "Thu, Jan 2, 2025"]);
  });

  it("labels today, yesterday, this year and other years", () => {
    const n = new Date();
    const at = (d: Date) => d.getTime() / 1000;
    const y = new Date(n.getTime() - 86_400_000);
    expect(dateLabel(at(n), n)).toBe("Today");
    expect(dateLabel(at(y), n)).toBe("Yesterday");
    expect(dateLabel(new Date("2020-03-05T12:00:00").getTime() / 1000, n)).toBe("Thu, Mar 5, 2020");
  });

  it("finds the applicable header for a position", () => {
    const items = groupRows([row({ id: 1 }), row({ id: 2 })], new Date());
    expect(headerAt(items, 2)).toBe(items[0].kind === "header" ? items[0].label : null);
    expect(headerAt([], 0)).toBeNull();
  });
});

describe("applyPatchToRow", () => {
  it("mirrors server rules: trimming, blanks to null, display payee", () => {
    const r = applyPatchToRow(row(), { payeeOverride: "  My Cafe ", notes: "  hi " }, tagsById);
    expect(r).toMatchObject({ payeeOverride: "My Cafe", notes: "hi", displayPayee: "My Cafe" });
    const cleared = applyPatchToRow(r, { payeeOverride: "  ", notes: "" }, tagsById);
    expect(cleared).toMatchObject({ payeeOverride: null, notes: null, displayPayee: "Bank Payee" });
  });

  it("sets category, flags and sorted tags without mutating the input", () => {
    const original = row();
    const r = applyPatchToRow(
      original,
      { categoryId: 7, isReviewed: true, isExcluded: true, tagIds: [1, 2, 99] },
      tagsById,
    );
    expect(r).toMatchObject({ categoryId: 7, isReviewed: true, isExcluded: true });
    expect(r.tags.map((t) => t.name)).toEqual(["a-tag", "b-tag"]); // unknown ids dropped, sorted
    expect(original.categoryId).toBeNull();
    expect(original.tags).toEqual([]);
  });

  it("clears the pair when a transfer is unmarked", () => {
    const r = applyPatchToRow(row({ isTransfer: true, transferPairId: 5 }), { isTransfer: false }, tagsById);
    expect(r).toMatchObject({ isTransfer: false, transferPairId: null });
    expect(applyPatchToRow(row(), { isTransfer: true }, tagsById).isTransfer).toBe(true);
  });
});

describe("applyBulkPatchToRow", () => {
  it("adds and removes tags and sets flags", () => {
    const r = applyBulkPatchToRow(
      row({ tags: [tagList[0]] }),
      { addTagIds: [2, 3], removeTagIds: [1], isReviewed: true, categoryId: null },
      tagsById,
    );
    expect(r.tags.map((t) => t.id)).toEqual([2, 3]);
    expect(r).toMatchObject({ isReviewed: true, categoryId: null });
  });
});
