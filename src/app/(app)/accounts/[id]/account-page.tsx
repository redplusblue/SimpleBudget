"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, parse } from "date-fns";
import { AlertTriangle, ArrowLeft, Check, Pencil, Plus, Scale, Settings2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ReconcileDialog } from "@/components/accounts/reconcile-dialog";
import { HoldingsCard } from "@/components/accounts/holdings-card";
import { ManualAccountControls } from "@/components/accounts/manual-account-controls";
import { ManualTransactionDialog } from "@/components/accounts/manual-transaction-dialog";
import { BalanceChart } from "@/components/charts/balance-chart";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Register } from "@/components/register/register";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ACCOUNTS_OVERVIEW_KEY } from "@/hooks/use-lookups";
import { CHART_PALETTE } from "@/db/palette";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { AccountDetail } from "@/lib/finance/accounts-overview";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/finance/account-types";
import { cn } from "@/lib/utils";

type AccountPatch = Partial<{
  displayName: string | null;
  type: AccountType;
  isHidden: boolean;
  isClosed: boolean;
  excludeFromNetWorth: boolean;
  color: string | null;
  creditLimitCents: number | null;
  lowBalanceCents: number | null;
}>;

const accountKey = (id: string) => ["account", id] as const;

function useAccountPatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AccountPatch) => fetchJson(`/api/accounts/${encodeURIComponent(id)}`, jsonBody("PATCH", patch)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountKey(id) });
      qc.invalidateQueries({ queryKey: ACCOUNTS_OVERVIEW_KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] }); // account names appear in rows
      qc.invalidateQueries({ queryKey: ["insights"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("Couldn't save that change"),
  });
}

export function AccountPage({ id }: { id: string }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: accountKey(id),
    queryFn: () => fetchJson<AccountDetail>(`/api/accounts/${encodeURIComponent(id)}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

  if (isError && error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="We couldn't find that account. It may have been removed."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/accounts">Back to accounts</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/accounts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
      >
        <ArrowLeft className="size-4" /> Accounts
      </Link>

      {isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load this account.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <Header id={id} detail={data} loading={isPending} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Balance, last 90 days</CardTitle>
              </CardHeader>
              <CardContent>
                <BalanceChart points={data?.series} currency={data?.account.currency} loading={isPending} />
              </CardContent>
            </Card>
            <MonthStats detail={data} loading={isPending} />
          </div>
        </>
      )}

      {data?.account.type === "investment" && <HoldingsCard accountId={id} currency={data.account.currency} />}

      <Register accountId={id} />
    </div>
  );
}

function Header({ id, detail, loading }: { id: string; detail: AccountDetail | undefined; loading: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addingTxn, setAddingTxn] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const patch = useAccountPatch(id);

  if (loading || !detail) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-12 w-48" />
      </div>
    );
  }
  const a = detail.account;
  return (
    <header className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <EditableName
            value={a.label}
            placeholder={a.name}
            onSave={(v) => patch.mutate({ displayName: v === a.name ? null : v })}
          />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {a.isManual ? "Manual account" : a.orgName}
            <Badge variant="outline">{ACCOUNT_TYPE_LABELS[a.type]}</Badge>
            {a.isClosed && <Badge variant="outline">Closed</Badge>}
            {a.isHidden && <Badge variant="outline">Hidden</Badge>}
            {a.excludeFromNetWorth && <Badge variant="outline">Not in net worth</Badge>}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-11 shrink-0 md:size-9"
          aria-label="Account settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 />
        </Button>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Money cents={a.balanceCents} currency={a.currency} className="hero-number" />
        {a.availableCents !== null && (
          <span className="text-sm text-muted-foreground">
            <Money cents={a.availableCents} currency={a.currency} /> available
          </span>
        )}
      </div>
      <Button variant="outline" className="mr-2 h-11 md:h-9" onClick={() => setReconciling(true)}>
        <Scale /> Reconcile
      </Button>
      <ReconcileDialog
        accountId={a.id}
        currency={a.currency}
        currentBalanceCents={a.balanceCents}
        open={reconciling}
        onOpenChange={setReconciling}
      />
      {a.isManual && (
        <>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setAddingTxn(true)}>
            <Plus /> Add transaction
          </Button>
          <ManualTransactionDialog accountId={a.id} open={addingTxn} onOpenChange={setAddingTxn} />
        </>
      )}
      {a.stale && !a.isClosed && (
        <p className="flex items-center gap-1.5 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {a.balanceDate
            ? `This balance is from ${formatDistanceToNowStrict(a.balanceDate * 1000, { addSuffix: true })}. Your bank may need attention.`
            : "This account hasn't reported a balance yet."}
        </p>
      )}
      <AccountSettings detail={detail} open={settingsOpen} onOpenChange={setSettingsOpen} id={id} />
    </header>
  );
}

function EditableName({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (t && t !== value) onSave(t);
    else setText(value);
  };

  if (!editing) {
    return (
      <h1 className="group flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <span className="truncate">{value}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Rename account"
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 hover:bg-surface-2 hover:opacity-100 focus-visible:opacity-100"
        >
          <Pencil className="size-4" />
        </button>
      </h1>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="flex items-center gap-1"
    >
      <Input
        ref={input}
        aria-label="Account name"
        value={text}
        placeholder={placeholder}
        maxLength={120}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText(value);
            setEditing(false);
          }
        }}
        className="h-10 text-lg font-semibold md:h-9"
      />
      <Button type="submit" size="icon" variant="ghost" aria-label="Save name" className="size-10 md:size-9">
        <Check />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Cancel"
        className="size-10 md:size-9"
        onClick={() => {
          setText(value);
          setEditing(false);
        }}
      >
        <X />
      </Button>
    </form>
  );
}

function MonthStats({ detail, loading }: { detail: AccountDetail | undefined; loading: boolean }) {
  const month = detail ? format(parse(detail.stats.month, "yyyy-MM", new Date()), "MMMM yyyy") : "This month";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{month}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading || !detail ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Money in</dt>
              <dd className="font-medium text-positive">
                <Money cents={detail.stats.inCents} currency={detail.account.currency} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Money out</dt>
              <dd className="font-medium">
                <Money cents={-detail.stats.outCents} currency={detail.account.currency} sign="never" />
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <dt className="font-medium">Net</dt>
              <dd className="text-base font-semibold">
                <Money cents={detail.stats.netCents} currency={detail.account.currency} sign="always" colorize />
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function AccountSettings({
  detail,
  open,
  onOpenChange,
  id,
}: {
  detail: AccountDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  id: string;
}) {
  const a = detail.account;
  const patch = useAccountPatch(id);
  const [name, setName] = useState(a.displayName ?? "");
  const [type, setType] = useState<AccountType>(a.type);
  const [color, setColor] = useState<string | null>(a.color);
  const [hidden, setHidden] = useState(a.isHidden);
  const [closed, setClosed] = useState(a.isClosed);
  const [excluded, setExcluded] = useState(a.excludeFromNetWorth);
  const [limit, setLimit] = useState(a.creditLimitCents === null ? "" : centsToDecimalString(a.creditLimitCents));
  const [low, setLow] = useState(a.lowBalanceCents === null ? "" : centsToDecimalString(a.lowBalanceCents));
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  // Start from the saved values every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(a.displayName ?? "");
      setType(a.type);
      setColor(a.color);
      setHidden(a.isHidden);
      setClosed(a.isClosed);
      setExcluded(a.excludeFromNetWorth);
      setLimit(a.creditLimitCents === null ? "" : centsToDecimalString(a.creditLimitCents));
      setLow(a.lowBalanceCents === null ? "" : centsToDecimalString(a.lowBalanceCents));
      setThresholdError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    const changes: AccountPatch = {};
    const newName = name.trim() || null;
    if (newName !== a.displayName) changes.displayName = newName;
    if (type !== a.type) changes.type = type;
    if (color !== a.color) changes.color = color;
    if (hidden !== a.isHidden) changes.isHidden = hidden;
    if (closed !== a.isClosed) changes.isClosed = closed;
    if (excluded !== a.excludeFromNetWorth) changes.excludeFromNetWorth = excluded;
    const toCents = (v: string): number | null | undefined => {
      if (!v.trim()) return null;
      try {
        const c = Math.abs(parseCents(v.trim().replace(/^\$/, "")));
        return c;
      } catch {
        return undefined;
      }
    };
    const newLimit = toCents(limit);
    const newLow = toCents(low);
    if (newLimit === undefined || newLow === undefined || newLimit === 0) {
      setThresholdError("Enter amounts like 5000 or 250.00 (or leave blank).");
      return;
    }
    setThresholdError(null);
    if (newLimit !== a.creditLimitCents) changes.creditLimitCents = newLimit;
    if (newLow !== a.lowBalanceCents) changes.lowBalanceCents = newLow;
    if (Object.keys(changes).length === 0) return onOpenChange(false);
    patch.mutate(changes, {
      onSuccess: () => {
        toast.success("Account updated");
        onOpenChange(false);
      },
    });
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Account settings"
      description={`${a.orgName} · ${a.name}`}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="acct-name">Display name</Label>
          <Input
            id="acct-name"
            value={name}
            placeholder={a.name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="h-11 md:h-9"
          />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
            <SelectTrigger aria-label="Account type" className="h-11 w-full md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Account color">
            {[null, ...CHART_PALETTE].map((c) => (
              <button
                key={c ?? "none"}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c ?? "Default"}
                onClick={() => setColor(c)}
                className={cn(
                  "grid size-9 place-items-center rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  color === c ? "scale-110 border-foreground" : "border-transparent",
                )}
                style={{ background: c ?? "var(--surface-2)" }}
              >
                {c === null && <X className="size-4 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          {type === "credit" ? (
            <>
              <Label htmlFor="acct-limit">Credit limit ($)</Label>
              <Input
                id="acct-limit"
                inputMode="decimal"
                placeholder="Optional, e.g. 5000"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="h-11 md:h-9"
              />
              <p className="text-xs text-muted-foreground">Used to flag high credit utilization in Insights.</p>
            </>
          ) : (
            <>
              <Label htmlFor="acct-low">Low-balance alert ($)</Label>
              <Input
                id="acct-low"
                inputMode="decimal"
                placeholder="Optional, e.g. 500"
                value={low}
                onChange={(e) => setLow(e.target.value)}
                className="h-11 md:h-9"
              />
              <p className="text-xs text-muted-foreground">Insights will warn you when the balance drops below this.</p>
            </>
          )}
          {thresholdError && (
            <p role="alert" className="text-sm text-negative">
              {thresholdError}
            </p>
          )}
        </div>
        {a.isManual && (
          <ManualAccountControls accountId={a.id} balanceCents={a.balanceCents} onClose={() => onOpenChange(false)} />
        )}
        <div className="space-y-3 rounded-xl border border-border p-3">
          <SwitchRow
            id="acct-hidden"
            label="Hide account"
            description="Remove it from lists and net worth. Its data is kept."
            checked={hidden}
            onChange={setHidden}
          />
          <SwitchRow
            id="acct-closed"
            label="Closed"
            description="Moves it to the closed section."
            checked={closed}
            onChange={setClosed}
          />
          <SwitchRow
            id="acct-nw"
            label="Exclude from net worth"
            description="Still shown, but not counted in totals."
            checked={excluded}
            onChange={setExcluded}
          />
        </div>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 md:h-9" onClick={save} disabled={patch.isPending}>
            Save
          </Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
}

function SwitchRow({
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
