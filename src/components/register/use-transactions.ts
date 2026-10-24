"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { TAGS_KEY } from "@/hooks/use-lookups";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import { filtersToSearchParams } from "@/lib/finance/transaction-params";
import type { BulkPatchInput, TransactionPatchInput } from "@/lib/finance/transaction-schemas";
import type {
  TagChip,
  TransactionDetail,
  TransactionFilters,
  TransactionPage,
  TransactionRow,
} from "@/lib/finance/transaction-types";
import { applyBulkPatchToRow, applyPatchToRow } from "./apply-patch";

export const TX_KEY = ["transactions"] as const;
export const txDetailKey = (id: number) => ["transaction", id] as const;

type Pages = InfiniteData<TransactionPage, string | null>;

export function useTransactions(filters: TransactionFilters) {
  const qs = filtersToSearchParams(filters).toString();
  return useInfiniteQuery({
    queryKey: [...TX_KEY, qs],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(qs);
      params.set("limit", "100");
      if (pageParam) params.set("cursor", pageParam);
      return fetchJson<TransactionPage>(`/api/transactions?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
}

type Snapshot = Array<[readonly unknown[], Pages | undefined]>;

/** Applies `fn` to every cached row of every cached transaction list; returns a snapshot for rollback. */
function mapCachedRows(qc: QueryClient, fn: (row: TransactionRow) => TransactionRow): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData<Pages>({ queryKey: TX_KEY })) {
    if (!data) continue;
    snapshot.push([key, data]);
    qc.setQueryData<Pages>(key, { ...data, pages: data.pages.map((p) => ({ ...p, rows: p.rows.map(fn) })) });
  }
  return snapshot;
}

const restore = (qc: QueryClient, snapshot: Snapshot | undefined) =>
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));

const tagMap = (qc: QueryClient) => new Map((qc.getQueryData<TagChip[]>(TAGS_KEY) ?? []).map((t) => [t.id, t]));

/** Finds a row anywhere in the cached lists. */
export function findCachedRow(qc: QueryClient, id: number): TransactionRow | undefined {
  for (const [, data] of qc.getQueriesData<Pages>({ queryKey: TX_KEY })) {
    for (const p of data?.pages ?? []) {
      const hit = p.rows.find((r) => r.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** After a transaction edit the account stats (excluded items) may change. */
const refreshAccountViews = (qc: QueryClient) => qc.invalidateQueries({ queryKey: ["account"] });

/** Optimistic single-transaction edit; rolls back with a toast if the server refuses. */
export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TransactionPatchInput }) =>
      fetchJson<{ transaction: TransactionDetail }>(`/api/transactions/${id}`, jsonBody("PATCH", patch)),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: TX_KEY });
      const tags = tagMap(qc);
      const pairId = patch.isTransfer === false ? findCachedRow(qc, id)?.transferPairId : null;
      const snapshot = mapCachedRows(qc, (row) => {
        if (row.id === id) return applyPatchToRow(row, patch, tags);
        if (pairId && row.id === pairId) return applyPatchToRow(row, { isTransfer: false }, tags);
        return row;
      });
      const detailKey = txDetailKey(id);
      const prevDetail = qc.getQueryData<TransactionDetail>(detailKey);
      if (prevDetail) qc.setQueryData(detailKey, applyPatchToRow(prevDetail, patch, tags));
      return { snapshot, prevDetail, detailKey };
    },
    onError: (err, _vars, ctx) => {
      restore(qc, ctx?.snapshot);
      if (ctx?.prevDetail) qc.setQueryData(ctx.detailKey, ctx.prevDetail);
      toast.error("Couldn't save that change", { description: err instanceof Error ? err.message : undefined });
    },
    onSuccess: (data, { id }) => {
      qc.setQueryData(txDetailKey(id), data.transaction);
      refreshAccountViews(qc);
    },
  });
}

/** Optimistic bulk edit. */
export function useBulkUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkPatchInput) => fetchJson<{ updated: number }>("/api/transactions", jsonBody("PATCH", body)),
    onMutate: async ({ ids, patch }) => {
      await qc.cancelQueries({ queryKey: TX_KEY });
      const tags = tagMap(qc);
      const set = new Set(ids);
      const snapshot = mapCachedRows(qc, (row) => (set.has(row.id) ? applyBulkPatchToRow(row, patch, tags) : row));
      ids.forEach((id) => qc.removeQueries({ queryKey: txDetailKey(id) }));
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      restore(qc, ctx?.snapshot);
      toast.error("Couldn't apply that to the selected transactions", {
        description: err instanceof Error ? err.message : undefined,
      });
    },
    onSuccess: () => refreshAccountViews(qc),
  });
}
