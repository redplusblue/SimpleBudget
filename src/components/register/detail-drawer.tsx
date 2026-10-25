"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeftRight, Plus, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCategories, useTags } from "@/hooks/use-lookups";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fetchJson } from "@/lib/fetch-json";
import type { TransactionPatchInput } from "@/lib/finance/transaction-schemas";
import type { TransactionDetail } from "@/lib/finance/transaction-types";
import { CategorySelect } from "./category-select";
import { TagPicker } from "./tag-picker";
import { txDetailKey, useUpdateTransaction } from "./use-transactions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

const when = (t: number) => format(new Date(t * 1000), "MMM d, yyyy h:mm a");

/** Right-hand sheet on desktop, bottom sheet on mobile. */
export function TransactionDrawer({
  id,
  onClose,
  onNavigate,
}: {
  id: number | null;
  onClose: () => void;
  onNavigate: (id: number) => void;
}) {
  const mobile = useMediaQuery("(max-width: 767px)");
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={mobile ? "max-h-[92dvh] gap-0 rounded-t-2xl" : "w-[460px] gap-0 sm:max-w-[460px]"}
      >
        {id !== null && <DrawerBody key={id} id={id} onNavigate={onNavigate} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ id, onNavigate }: { id: number; onNavigate: (id: number) => void }) {
  const {
    data: tx,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: txDetailKey(id),
    queryFn: async () => (await fetchJson<{ transaction: TransactionDetail }>(`/api/transactions/${id}`)).transaction,
  });
  const { data: categories = [] } = useCategories();
  const { data: allTags = [] } = useTags();
  const update = useUpdateTransaction();
  const save = (patch: TransactionPatchInput) => update.mutate({ id, patch });

  const [payee, setPayee] = useState("");
  const [notes, setNotes] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  // Seed the text fields once the detail arrives (and again if the server changed them).
  useEffect(() => {
    if (tx) {
      setPayee(tx.payeeOverride ?? "");
      setNotes(tx.notes ?? "");
    }
  }, [tx?.payeeOverride, tx?.notes, tx?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="truncate">{tx?.displayPayee ?? "Transaction"}</SheetTitle>
        <SheetDescription className="sr-only">Transaction details and your edits</SheetDescription>
        {tx && (
          <div className="flex items-baseline justify-between gap-3">
            <Money
              cents={tx.amountCents}
              currency={tx.currency}
              colorize
              className="text-2xl font-semibold tracking-tight"
            />
            <span className="text-sm text-muted-foreground">
              {tx.pending ? "Pending" : format(new Date(tx.posted * 1000), "EEE, MMM d, yyyy")}
            </span>
          </div>
        )}
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {isPending && (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load this transaction.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {tx && (
          <>
            <section aria-label="Your edits" className="space-y-4">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your edits</h3>

              <div className="space-y-2">
                <Label htmlFor="payee-override">Payee name</Label>
                <Input
                  id="payee-override"
                  value={payee}
                  placeholder={tx.payee ?? tx.description}
                  onChange={(e) => setPayee(e.target.value)}
                  onBlur={() => payee.trim() !== (tx.payeeOverride ?? "") && save({ payeeOverride: payee })}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="h-11 md:h-9"
                />
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <CategorySelect
                  value={tx.categoryId}
                  categories={categories}
                  onChange={(c) => save({ categoryId: c })}
                  aria-label="Category"
                />
              </div>

              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tx.tags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-2.5 text-xs"
                    >
                      <span aria-hidden className="size-1.5 rounded-full" style={{ background: t.color }} />
                      {t.name}
                      <button
                        type="button"
                        aria-label={`Remove tag ${t.name}`}
                        className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground"
                        onClick={() => save({ tagIds: tx.tags.filter((x) => x.id !== t.id).map((x) => x.id) })}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <TagPicker
                    selectedIds={tx.tags.map((t) => t.id)}
                    onPick={(tag) => {
                      const has = tx.tags.some((t) => t.id === tag.id);
                      save({
                        tagIds: has
                          ? tx.tags.filter((t) => t.id !== tag.id).map((t) => t.id)
                          : [...tx.tags.map((t) => t.id), tag.id],
                      });
                    }}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full px-2.5 text-xs"
                      aria-label="Add tag"
                    >
                      <Plus className="size-3" /> {tx.tags.length ? "" : "Add tag"}
                    </Button>
                  </TagPicker>
                </div>
                {allTags.length === 0 && tx.tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">Tags are optional. Type a name to create one.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  maxLength={2000}
                  placeholder="Add a note…"
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => notes.trim() !== (tx.notes ?? "") && save({ notes })}
                />
              </div>

              <div className="space-y-3 rounded-xl border border-border p-3">
                <ToggleRow
                  id="reviewed"
                  label="Reviewed"
                  description="Mark as checked"
                  checked={tx.isReviewed}
                  onChange={(v) => save({ isReviewed: v })}
                />
                <ToggleRow
                  id="excluded"
                  label="Exclude from stats"
                  description="Hide from spending totals, e.g. if reimbursed"
                  checked={tx.isExcluded}
                  onChange={(v) => save({ isExcluded: v })}
                />
                <ToggleRow
                  id="transfer"
                  label="Transfer"
                  description={
                    tx.isTransfer ? "Not counted as spending or income" : "Money moved between your own accounts"
                  }
                  checked={tx.isTransfer}
                  onChange={(v) => save({ isTransfer: v })}
                />
                {tx.isTransfer && tx.pair && (
                  <button
                    type="button"
                    onClick={() => onNavigate(tx.pair!.id)}
                    className="flex w-full items-center gap-2 rounded-lg bg-surface-2 p-2.5 text-left text-sm hover:bg-border"
                  >
                    <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      Other side: {tx.pair.accountName} · {tx.pair.displayPayee}
                    </span>
                    <Money cents={tx.pair.amountCents} currency={tx.pair.currency} colorize className="shrink-0" />
                  </button>
                )}
                {tx.isTransfer && !tx.pair && (
                  <p className="text-xs text-muted-foreground">Flagged as a transfer with no matching transaction.</p>
                )}
              </div>

              <Button asChild variant="outline" className="h-11 w-full justify-start gap-2 md:h-9">
                <Link href={`/rules?from=${tx.id}`}>
                  <Wand2 className="size-4" /> Create rule from this…
                </Link>
              </Button>
            </section>

            <section aria-label="From your bank" className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">From your bank</h3>
              <p className="text-xs text-muted-foreground">
                Imported data is read-only, so a re-sync never overwrites your edits.
              </p>
              <dl className="divide-y divide-border/60 rounded-xl border border-border px-3">
                <Row label="Account">{tx.accountName}</Row>
                <Row label={tx.pending ? "Purchased" : "Posted"}>{when(tx.pending ? tx.effectiveDate : tx.posted)}</Row>
                {tx.transactedAt && !tx.pending && <Row label="Transacted">{when(tx.transactedAt)}</Row>}
                <Row label="Amount">
                  <Money cents={tx.amountCents} currency={tx.currency} />
                </Row>
                <Row label="Description">{tx.description}</Row>
                {tx.payee && <Row label="Payee">{tx.payee}</Row>}
                {tx.memo && <Row label="Memo">{tx.memo}</Row>}
                <Row label="Status">{tx.pending ? "Pending" : "Posted"}</Row>
                <Row label="Imported">{when(tx.importedAt)}</Row>
              </dl>
              <button
                type="button"
                onClick={() => setRawOpen((o) => !o)}
                aria-expanded={rawOpen}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                {rawOpen ? "Hide" : "Show"} raw data
              </button>
              {rawOpen && (
                <pre className="max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 text-[11px] leading-relaxed">
                  {prettyJson(tx.rawJson)}
                </pre>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="flex-col items-start gap-0.5 text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
