"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInvalidateTaxonomy } from "@/hooks/use-invalidate";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { AnyProposalView } from "@/lib/ai/proposal-types";
import { MEMORIES_KEY } from "./memory-list";

function Wording({ p }: { p: AnyProposalView }) {
  if (p.kind === "memory") return <p className="text-sm break-words">Remember: &ldquo;{p.payload.text}&rdquo;</p>;
  if (p.kind === "target")
    return (
      <p className="text-sm">
        Monthly target for <strong>{p.payload.categoryName}</strong>: <Money cents={p.payload.amountCents} />
      </p>
    );
  const a = p.payload.action;
  const label = a.type === "category" ? a.categoryName : a.tagName;
  const t = p.payload.target;
  return (
    <div className="space-y-0.5 text-sm">
      <p className="break-words">
        {t.mode === "extend" ? `Add to rule ${t.ruleName}` : `New rule ${t.ruleName}`}: payee{" "}
        {p.payload.pattern.op === "equals" ? "is" : "contains"} <strong>{p.payload.pattern.value}</strong> →{" "}
        {a.type === "tag" ? "tag " : ""}
        <strong>{label}</strong>
      </p>
      {p.preview && (
        <p className="text-xs text-muted-foreground">
          Matches {p.preview.matched} · fills {p.preview.wouldChange}
          {p.preview.conflicts > 0 && (
            <span className="text-negative"> · {p.preview.conflicts} already categorized differently</span>
          )}
        </p>
      )}
    </div>
  );
}

/** A change the assistant proposed: nothing happens until Apply is pressed. */
export function ProposalCard({ proposal }: { proposal: AnyProposalView }) {
  const qc = useQueryClient();
  const invalidateTaxonomy = useInvalidateTaxonomy();
  const [state, setState] = useState<"applied" | "dismissed" | null>(null);
  const status =
    state ?? (proposal.status === "accepted" ? "applied" : proposal.status === "pending" ? null : "dismissed");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-proposals"] });
    qc.invalidateQueries({ queryKey: MEMORIES_KEY });
    invalidateTaxonomy();
  };
  const apply = useMutation({
    mutationFn: () => fetchJson(`/api/ai/proposals/${proposal.id}/accept`, jsonBody("POST", { applyExisting: true })),
    onSuccess: () => {
      setState("applied");
      toast.success("Applied");
      refresh();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't apply that"),
  });
  const dismiss = useMutation({
    mutationFn: () => fetchJson(`/api/ai/proposals/${proposal.id}/dismiss`, { method: "POST" }),
    onSuccess: () => setState("dismissed"),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't dismiss that"),
  });

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-2/40 p-3" data-testid="proposal-card">
      <Wording p={proposal} />
      {!proposal.stillValid && <p className="text-xs text-negative">{proposal.problem}</p>}
      {status ? (
        <Badge variant={status === "applied" ? "secondary" : "outline"}>
          {status === "applied" ? "Applied" : "Dismissed"}
        </Badge>
      ) : (
        <div className="flex gap-2">
          {proposal.stillValid && (
            <Button
              className="h-11 md:h-9"
              onClick={() => apply.mutate()}
              disabled={apply.isPending || dismiss.isPending}
            >
              {apply.isPending ? <Loader2 className="animate-spin" /> : <Check />} Apply
            </Button>
          )}
          <Button
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => dismiss.mutate()}
            disabled={apply.isPending || dismiss.isPending}
          >
            <X /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
