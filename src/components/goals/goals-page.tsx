"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Flag, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { GoalProgress } from "@/lib/finance/goals-types";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./progress-ring";

const KEY = ["goals"] as const;

interface AccountOption {
  id: string;
  name: string;
  displayName: string | null;
  type: string;
  isHidden: boolean;
  isClosed: boolean;
}

const STATUS_TEXT: Record<GoalProgress["status"], string> = {
  done: "Reached",
  on_track: "On track",
  behind: "Behind pace",
  no_date: "No deadline",
};

function Summary({ g }: { g: GoalProgress }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="truncate font-medium">{g.name}</span>
        <span
          className={cn(
            "text-xs",
            g.status === "done" || g.status === "on_track"
              ? "text-positive"
              : g.status === "behind"
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          {STATUS_TEXT[g.status]}
        </span>
      </p>
      <p className="text-sm">
        <Money cents={g.savedCents} currency={g.currency} className="font-medium" />{" "}
        <span className="text-muted-foreground">of</span> <Money cents={g.targetCents} currency={g.currency} />
      </p>
      <p className="text-xs text-muted-foreground">
        In {g.accountName}
        {g.targetDate && <> · by {format(parseISO(g.targetDate), "MMM d, yyyy")}</>}
      </p>
      {g.status !== "done" && (
        <p className="text-xs text-muted-foreground">
          {g.neededPerMonthCents !== null && (
            <>
              Needs <Money cents={g.neededPerMonthCents} currency={g.currency} /> a month.{" "}
            </>
          )}
          {g.projectedDate ? (
            <>At your recent pace: {format(parseISO(g.projectedDate), "MMM yyyy")}.</>
          ) : g.recentPerMonthCents !== null ? (
            "The balance hasn't been growing lately."
          ) : (
            "Needs a few weeks of balance history to project."
          )}
        </p>
      )}
    </div>
  );
}

export function GoalsPage() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ goals: GoalProgress[] }>("/api/goals")).goals,
  });
  const [editing, setEditing] = useState<GoalProgress | "new" | null>(null);
  const [deleting, setDeleting] = useState<GoalProgress | null>(null);
  const remove = useMutation({
    mutationFn: (g: GoalProgress) => fetchJson(`/api/goals/${g.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Goal removed");
      setDeleting(null);
    },
    onError: () => toast.error("Couldn't remove that goal"),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Savings goals, tracked against the balance of an account.
          </p>
        </div>
        <Button className="h-11 md:h-9" onClick={() => setEditing("new")}>
          <Plus /> New goal
        </Button>
      </div>

      {query.isPending ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
        >
          <span className="text-negative">Couldn&apos;t load your goals.</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No goals yet. Set one for an emergency fund, a trip or a down payment."
          action={
            <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
              Create a goal
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="goals-list">
          {query.data.map((g) => (
            <li key={g.id}>
              <Card data-testid="goal-card">
                <CardContent className="flex items-start gap-4">
                  <ProgressRing fraction={g.fraction} done={g.status === "done"} />
                  <Summary g={g} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 md:size-9"
                        aria-label={`Actions for ${g.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditing(g)}>
                        <Pencil /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(g)}>
                        <Trash2 /> Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <GoalDialog editing={editing} onClose={() => setEditing(null)} />
      <ResponsiveDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this goal?"
        description="Your account and its balance aren't affected."
      >
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-11 md:h-9"
            disabled={remove.isPending}
            onClick={() => deleting && remove.mutate(deleting)}
          >
            {remove.isPending && <Loader2 className="animate-spin" />} Remove
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
}

function GoalDialog({ editing, onClose }: { editing: GoalProgress | "new" | null; onClose: () => void }) {
  return (
    <ResponsiveDialog
      open={editing !== null}
      onOpenChange={(o) => !o && onClose()}
      title={editing === "new" ? "New goal" : "Edit goal"}
      description="Progress is the account's balance above the amount you start from."
    >
      {editing !== null && (
        <GoalForm
          key={editing === "new" ? "new" : editing.id}
          goal={editing === "new" ? null : editing}
          onClose={onClose}
        />
      )}
    </ResponsiveDialog>
  );
}

function GoalForm({ goal, onClose }: { goal: GoalProgress | null; onClose: () => void }) {
  const qc = useQueryClient();
  const accountsQuery = useQuery({
    queryKey: ["accounts-raw"],
    queryFn: async () => (await fetchJson<{ accounts: AccountOption[] }>("/api/accounts")).accounts,
  });
  const accounts = (accountsQuery.data ?? []).filter(
    (a) => !a.isHidden && !a.isClosed && a.type !== "credit" && a.type !== "loan",
  );
  const [name, setName] = useState(goal?.name ?? "");
  const [accountId, setAccountId] = useState(goal?.accountId ?? "");
  const [target, setTarget] = useState(goal ? centsToDecimalString(goal.targetCents) : "");
  const [start, setStart] = useState(goal ? centsToDecimalString(goal.startCents) : "");
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const money = (v: string, label: string) => {
        try {
          return Math.abs(parseCents(v.trim().replace(/^\$/, "")));
        } catch {
          throw new Error(`Enter ${label} like 5000 or 5000.00`);
        }
      };
      const body = {
        name,
        accountId,
        targetCents: money(target, "the target"),
        startCents: start.trim() ? money(start, "the starting amount") : 0,
        targetDate: date || null,
      };
      return goal
        ? fetchJson(`/api/goals/${goal.id}`, jsonBody("PUT", body))
        : fetchJson("/api/goals", jsonBody("POST", body));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success(goal ? "Goal updated" : "Goal added");
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save the goal"),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="goal-name">Name</Label>
        <Input
          id="goal-name"
          value={name}
          maxLength={80}
          placeholder="e.g. Emergency fund"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      <div className="space-y-2">
        <Label>Account holding the money</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger aria-label="Account" className="h-11 w-full md:h-9">
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.displayName || a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="goal-target">Target ($)</Label>
          <Input
            id="goal-target"
            inputMode="decimal"
            value={target}
            placeholder="5000"
            onChange={(e) => setTarget(e.target.value)}
            className="h-11 md:h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-start">Already there ($)</Label>
          <Input
            id="goal-start"
            inputMode="decimal"
            value={start}
            placeholder="0"
            onChange={(e) => setStart(e.target.value)}
            className="h-11 md:h-9"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        &ldquo;Already there&rdquo; is money in the account that isn&apos;t part of this goal; only the balance above it
        counts.
      </p>
      <div className="space-y-2">
        <Label htmlFor="goal-date">Target date (optional)</Label>
        <Input
          id="goal-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-11 md:h-9"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-11 md:h-9"
          disabled={save.isPending || !name.trim() || !accountId || !target.trim()}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {goal ? "Save" : "Add goal"}
        </Button>
      </div>
    </form>
  );
}
