"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useAiConfig } from "@/components/ai/ai-config";
import { MarkdownLite } from "@/components/ai/markdown-lite";
import { ModelPicker } from "@/components/ai/model-picker";
import { readNdjson } from "@/components/ai/read-ndjson";
import { ProposalCard } from "@/components/assistant/proposal-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AnyProposalView } from "@/lib/ai/proposal-types";
import type { TraceEvent } from "@/lib/ai/trace-explain";

/** An optional, owner-pressed explanation of this charge. Renders nothing while AI is off. */
export function TraceExplain({ id }: { id: number }) {
  const { data: config } = useAiConfig();
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState<string>();
  const [answer, setAnswer] = useState("");
  const [proposals, setProposals] = useState<AnyProposalView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);

  if (!config?.enabled) return null;

  async function explain() {
    setBusy(true);
    setError(null);
    setAnswer("");
    setProposals([]);
    setCost(null);
    try {
      const res = await fetch(`/api/transactions/${id}/trace/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(model ? { model } : {}),
          ...(question.trim() ? { question: question.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Couldn't reach the AI.");
      }
      await readNdjson<TraceEvent>(res, (e) => {
        if (e.type === "text") setAnswer((a) => a + e.text);
        else if (e.type === "proposal") setProposals((p) => [...p, e.proposal]);
        else if (e.type === "done") setCost(e.costMicros);
        else if (e.type === "error") setError(e.message);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't explain that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Explain with AI" className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Explain with AI</h3>
      <p className="text-xs text-muted-foreground">
        Sends the statistics above (no raw bank text, notes or account details), not your transactions.
      </p>
      <Input
        aria-label="Ask about this charge"
        placeholder="Ask about this charge (optional)"
        value={question}
        maxLength={500}
        onChange={(e) => setQuestion(e.target.value)}
        className="h-11 md:h-9"
      />
      <div className="flex flex-wrap items-center gap-2">
        <ModelPicker feature="trace" value={model} onChange={setModel} className="w-44" />
        <Button className="h-11 md:h-9" onClick={explain} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Explain with AI
        </Button>
      </div>
      {answer && (
        <div data-testid="trace-explanation" aria-live="polite" aria-busy={busy}>
          <MarkdownLite text={answer} />
        </div>
      )}
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
      {cost != null && <p className="text-xs text-muted-foreground">${(cost / 1_000_000).toFixed(4)}</p>}
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
