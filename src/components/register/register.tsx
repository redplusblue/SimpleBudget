"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ReceiptText, SearchX } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/hooks/use-lookups";
import { useMediaQuery } from "@/hooks/use-media-query";
import { countActiveFilters, filtersFromSearchParams, filtersToSearchParams } from "@/lib/finance/transaction-params";
import type { BulkPatchInput } from "@/lib/finance/transaction-schemas";
import type { TransactionFilters } from "@/lib/finance/transaction-types";
import { BulkBar } from "./bulk-bar";
import { TransactionDrawer } from "./detail-drawer";
import { FiltersBar } from "./filters-bar";
import { groupRows, headerAt } from "./group";
import { desktopColumns, TransactionRowItem } from "./transaction-row";
import { useBulkUpdate, useTransactions, useUpdateTransaction } from "./use-transactions";

const HEADER_HEIGHT = 36;
const ROW_HEIGHT_DESKTOP = 57;
const ROW_HEIGHT_MOBILE = 65;
const PREFETCH_ROWS = 15;

/**
 * The transaction register: virtualized, infinitely scrolling, grouped by day, with URL-backed filters.
 * Scoped to one account when `accountId` is given (running balances are then available).
 */
export function Register({ accountId }: { accountId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const { data: categories = [] } = useCategories();

  // Filters live in the URL so views are shareable and charts can deep-link here.
  const urlFilters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const filters: TransactionFilters = useMemo(
    () => (accountId ? { ...urlFilters, accountId } : urlFilters),
    [urlFilters, accountId],
  );

  const setFilters = useCallback(
    (patch: Partial<TransactionFilters>) => {
      const next = { ...urlFilters, ...patch };
      const params = filtersToSearchParams(accountId ? { ...next, accountId: undefined } : next);
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [urlFilters, accountId, router, pathname],
  );
  const clearFilters = useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]);

  const query = useTransactions(filters);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total;
  const items = useMemo(() => groupRows(rows), [rows]);
  const showBalance = !!accountId && countActiveFilters(filters) === 0 && !isMobile;

  // Selection (checkboxes on desktop, long-press on mobile).
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const filterKey = filtersToSearchParams(filters).toString();
  useEffect(() => {
    setSelected(new Set());
    setSelectionMode(false);
  }, [filterKey]);
  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);
  const startSelecting = useCallback((id: number) => {
    setSelectionMode(true);
    setSelected((prev) => new Set(prev).add(id));
  }, []);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectionMode(false);
  }, []);

  const { mutate: updateTransaction } = useUpdateTransaction();
  const bulk = useBulkUpdate();
  const onCategoryChange = useCallback(
    (id: number, categoryId: number | null) => updateTransaction({ id, patch: { categoryId } }),
    [updateTransaction],
  );
  const applyBulk = (patch: BulkPatchInput["patch"]) =>
    bulk.mutate({ ids: [...selected], patch }, { onSuccess: clearSelection });

  const [openId, setOpenId] = useState<number | null>(null);

  // Virtualized list against the window scroll.
  const listRef = useRef<HTMLDivElement>(null);
  // The list starts part-way down the page; the window virtualizer needs that offset to map scroll position to rows.
  const [scrollMargin, setScrollMargin] = useState(0);
  const hasList = rows.length > 0;
  useLayoutEffect(() => {
    const measure = () =>
      listRef.current && setScrollMargin(listRef.current.getBoundingClientRect().top + window.scrollY);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasList, showBalance, isMobile]);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) =>
      items[i].kind === "header" ? HEADER_HEIGHT : isMobile ? ROW_HEIGHT_MOBILE : ROW_HEIGHT_DESKTOP,
    overscan: 6,
    scrollMargin,
    getItemKey: (i) => {
      const item = items[i];
      return item.kind === "header" ? `h:${item.key}` : `r:${item.row.id}`;
    },
  });
  const virtualItems = virtualizer.getVirtualItems();

  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && items.length > 0 && lastIndex >= items.length - PREFETCH_ROWS)
      fetchNextPage();
  }, [lastIndex, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const stickyLabel = headerAt(items, virtualItems[0]?.index ?? 0);
  const active = countActiveFilters(filters);
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      <FiltersBar filters={filters} onChange={setFilters} onClear={clearFilters} scopedToAccount={!!accountId} />

      {query.isPending ? (
        <div className="space-y-2" aria-busy aria-label="Loading transactions">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load transactions.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        active > 0 ? (
          <EmptyState
            icon={SearchX}
            title="No transactions match these filters."
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState icon={ReceiptText} title="No transactions yet. They'll appear after your next sync." />
        )
      ) : (
        <div className="overflow-clip rounded-2xl border border-border bg-card">
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 flex h-9 items-center gap-3 border-b border-border bg-surface-2/95 px-3 text-xs font-medium backdrop-blur">
            <span className="hidden w-7 md:flex">
              <Checkbox
                checked={allLoadedSelected}
                onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                aria-label="Select all loaded transactions"
              />
            </span>
            <span className="text-muted-foreground" aria-live="polite">
              {stickyLabel}
            </span>
            <span className="ml-auto text-muted-foreground">
              {total !== undefined && `${total.toLocaleString()} transaction${total === 1 ? "" : "s"}`}
            </span>
          </div>
          {showBalance && (
            <div
              className="hidden border-b border-border px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase md:grid md:gap-3"
              style={{ gridTemplateColumns: desktopColumns(true) }}
            >
              <span />
              <span>Payee</span>
              <span>Category</span>
              <span>Tags</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Balance</span>
            </div>
          )}
          <div
            ref={listRef}
            role="list"
            aria-label="Transactions"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualItems.map((v) => {
              const item = items[v.index];
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  role={item.kind === "row" ? "listitem" : "presentation"}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  {item.kind === "header" ? (
                    <div className="flex h-9 items-center bg-surface-2/50 px-3 text-xs font-medium text-muted-foreground">
                      {item.label}
                    </div>
                  ) : (
                    <TransactionRowItem
                      row={item.row}
                      categories={categories}
                      showAccount={!accountId}
                      showBalance={showBalance}
                      mobile={isMobile}
                      selected={selected.has(item.row.id)}
                      selectionMode={selectionMode}
                      onOpen={setOpenId}
                      onToggleSelect={toggleSelect}
                      onLongPress={startSelecting}
                      onCategoryChange={onCategoryChange}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {isFetchingNextPage && <div className="p-3 text-center text-xs text-muted-foreground">Loading more…</div>}
          {!hasNextPage && rows.length > 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">End of transactions</div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <BulkBar count={selected.size} categories={categories} onApply={applyBulk} onClear={clearSelection} />
      )}
      <TransactionDrawer id={openId} onClose={() => setOpenId(null)} onNavigate={setOpenId} />
    </div>
  );
}
