"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { CachedSummary } from "@/lib/llm/narrative";
import { useAiConfig } from "./ai-config";
import { MarkdownLite } from "./markdown-lite";
import { ModelPicker } from "./model-picker";

const SUMMARY_KEY = ["ai-summary"] as const;

interface Turn {
  role: "user" | "assistant";
  content: string;
}

function SummaryCard() {
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: () => fetchJson<{ enabled: boolean; summary: CachedSummary | null }>("/api/insights/summary"),
    staleTime: 30_000,
  });
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>();

  async function generate() {
    setBusy(true);
    setError(null);
    setStreaming("");
    try {
      const res = await fetch("/api/insights/summary", {
        method: "POST",
        ...(model ? jsonBody("POST", { model }) : {}),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Couldn't reach the summary service.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let failed: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (event.type === "text") {
            text += event.text ?? "";
            setStreaming(text);
          } else if (event.type === "error") failed = event.message ?? "The summary failed.";
        }
      }
      if (failed) throw new Error(failed);
      await qc.invalidateQueries({ queryKey: SUMMARY_KEY });
      setStreaming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The summary failed.");
      setStreaming(null);
    } finally {
      setBusy(false);
    }
  }

  const summary = saved.data?.summary;
  const shown = streaming ?? summary?.text ?? null;
  return (
    <Card aria-labelledby="ai-summary-title">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="ai-summary-title" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="size-4" aria-hidden /> Monthly summary
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ModelPicker feature="insights" value={model} onChange={setModel} className="w-44" />
            <Button variant="outline" size="sm" onClick={generate} disabled={busy} className="h-11 md:h-9">
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {summary || streaming ? "Regenerate" : "Write summary"}
            </Button>
          </div>
        </div>
        {saved.isPending && !shown ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shown ? (
          <div data-testid="ai-summary" aria-live="polite" aria-busy={busy}>
            <MarkdownLite text={shown} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask for a short written summary of this month. It&apos;s saved until your next sync.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error} <span className="text-muted-foreground">Your insights below are unaffected.</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AskCard() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    const history = turns.slice(-10);
    setTurns((t) => [...t, { role: "user", content: q }]);
    setQuestion("");
    try {
      const { answer } = await fetchJson<{ answer: string }>(
        "/api/insights/ask",
        jsonBody("POST", { question: q, history, ...(model ? { model } : {}) }),
      );
      setTurns((t) => [...t, { role: "assistant", content: answer || "I don't have an answer for that." }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't get an answer.");
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ block: "nearest" }), 0);
    }
  }

  return (
    <Card aria-labelledby="ai-ask-title">
      <CardContent className="space-y-3">
        <h2 id="ai-ask-title" className="text-sm font-medium text-muted-foreground">
          Ask about your spending
        </h2>
        {turns.length > 0 && (
          <ul className="space-y-3" data-testid="ai-chat">
            {turns.map((t, i) => (
              <li key={i} className={t.role === "user" ? "ml-8 rounded-2xl bg-surface-2 px-3 py-2 text-sm" : ""}>
                {t.role === "user" ? t.content : <MarkdownLite text={t.content} />}
              </li>
            ))}
            <div ref={endRef} />
          </ul>
        )}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <ModelPicker feature="chat" value={model} onChange={setModel} className="w-full md:w-64" />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <Input
            aria-label="Your question"
            placeholder="e.g. How much did I spend on coffee this year?"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            className="h-11 md:h-9"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0 md:size-9"
            disabled={busy || !question.trim()}
            aria-label="Ask"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The optional AI half of the Insights page. Renders only a quiet hint when AI is off. */
export function AiPanel() {
  const { data } = useAiConfig();
  if (!data) return null;
  if (!data.enabled)
    return (
      <p className="text-sm text-muted-foreground">
        Want a written monthly summary or to ask questions?{" "}
        <Link href="/settings/ai" className="text-link underline-offset-4 hover:underline">
          Set up AI
        </Link>{" "}
        (optional).
      </p>
    );
  return (
    <div className="space-y-4">
      <SummaryCard />
      <AskCard />
    </div>
  );
}
