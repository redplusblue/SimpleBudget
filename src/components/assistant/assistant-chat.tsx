"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquarePlus, MessagesSquare, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAiConfig } from "@/components/ai/ai-config";
import { MarkdownLite } from "@/components/ai/markdown-lite";
import { ModelPicker } from "@/components/ai/model-picker";
import { readNdjson } from "@/components/ai/read-ndjson";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/fetch-json";
import type { ChatEvent } from "@/lib/ai/assistant";
import { LENSES, LENS_IDS, isLensId, type LensId } from "@/lib/ai/lenses";
import type { AnyProposalView } from "@/lib/ai/proposal-types";
import { ProposalCard } from "./proposal-card";

const THREADS_KEY = ["ai-threads"] as const;

interface ThreadRow {
  id: number;
  title: string;
  lens: string;
  updatedAt: number;
}
interface Msg {
  key: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  costMicros?: number | null;
  proposals: AnyProposalView[];
}
interface ThreadPayload {
  thread: ThreadRow;
  messages: Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    model: string | null;
    costMicros: number | null;
    createdAt: number;
  }>;
  proposals: AnyProposalView[];
}

const cost = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

/** Puts each proposal under the assistant message of the same turn (they share a timestamp). */
function toMessages(p: ThreadPayload): Msg[] {
  const assistants = p.messages.filter((m) => m.role === "assistant");
  return p.messages.map((m) => ({
    key: `m${m.id}`,
    role: m.role,
    content: m.content,
    model: m.model,
    costMicros: m.costMicros,
    proposals:
      m.role === "assistant"
        ? p.proposals.filter(
            (pr) => (assistants.find((a) => a.createdAt >= pr.createdAt) ?? assistants.at(-1))?.id === m.id,
          )
        : [],
  }));
}

function setThreadParam(id: number | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("thread", String(id));
  else url.searchParams.delete("thread");
  window.history.replaceState(null, "", url);
}

function ThreadList(props: {
  activeId: number | null;
  onSelect: (id: number) => void;
  onDeleted: (id: number) => void;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: THREADS_KEY,
    queryFn: async () => (await fetchJson<{ threads: ThreadRow[] }>("/api/ai/threads")).threads,
  });
  async function remove(t: ThreadRow) {
    try {
      await fetchJson(`/api/ai/threads/${t.id}`, { method: "DELETE" });
      props.onDeleted(t.id);
      qc.invalidateQueries({ queryKey: THREADS_KEY });
    } catch {
      toast.error("Couldn't delete that conversation");
    }
  }
  if (query.isPending) return <Skeleton className="h-24 w-full rounded-xl" aria-busy />;
  if (query.isError)
    return (
      <div role="alert" className="text-sm">
        <span className="text-negative">Couldn&apos;t load conversations.</span>{" "}
        <Button variant="link" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (query.data.length === 0) return <p className="text-sm text-muted-foreground">No conversations yet.</p>;
  return (
    <ul className="space-y-1" aria-label="Conversations">
      {query.data.map((t) => (
        <li key={t.id} className="flex items-center gap-1">
          <Button
            variant={t.id === props.activeId ? "secondary" : "ghost"}
            className="h-11 min-w-0 flex-1 justify-start md:h-9"
            onClick={() => props.onSelect(t.id)}
          >
            <span className="truncate">{t.title}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 md:size-9"
            aria-label={`Delete conversation: ${t.title}`}
            onClick={() => remove(t)}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function AssistantChat() {
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<number | null>(null);
  const [lens, setLens] = useState<LensId>("general");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [model, setModel] = useState<string>();
  const { data: config } = useAiConfig();
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const open = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ThreadPayload>(`/api/ai/threads/${id}`);
      setThreadId(id);
      setLens(isLensId(data.thread.lens) ? data.thread.lens : "general");
      setMsgs(toMessages(data));
      setThreadParam(id);
    } catch {
      setError("Couldn't load that conversation.");
      setThreadParam(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // A reload (or a link) with ?thread=<id> reopens that conversation.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("thread"));
    if (Number.isInteger(id) && id > 0) void open(id);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs]);

  function newChat(nextLens: LensId = lens) {
    setThreadId(null);
    setMsgs([]);
    setError(null);
    setLens(nextLens);
    setThreadParam(null);
    setSheetOpen(false);
  }

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const turn = Date.now();
    setMsgs((m) => [
      ...m,
      { key: `u${turn}`, role: "user", content: message, proposals: [] },
      { key: `a${turn}`, role: "assistant", content: "", proposals: [] },
    ]);
    const patchLast = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(threadId ? { threadId } : {}),
          lens,
          text: message,
          ...(model ? { model } : {}),
          ...(web && config?.webSearch ? { web: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? "Couldn't reach the assistant.");
      }
      await readNdjson<ChatEvent>(res, (e) => {
        if (e.type === "thread") {
          setThreadId(e.threadId);
          setThreadParam(e.threadId);
        } else if (e.type === "text") patchLast((m) => ({ ...m, content: m.content + e.text }));
        else if (e.type === "proposal") patchLast((m) => ({ ...m, proposals: [...m.proposals, e.proposal] }));
        else if (e.type === "done")
          patchLast((m) => ({ ...m, key: `m${e.messageId}`, model, costMicros: e.costMicros }));
        else if (e.type === "error") {
          setError(e.message);
          setMsgs((all) => (all.at(-1)?.content === "" && all.at(-1)?.proposals.length === 0 ? all.slice(0, -1) : all));
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get an answer.");
      setMsgs((all) => (all.at(-1)?.role === "assistant" && all.at(-1)?.content === "" ? all.slice(0, -1) : all));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: THREADS_KEY });
      qc.invalidateQueries({ queryKey: ["ai-usage"] });
    }
  }

  const list = (
    <ThreadList
      activeId={threadId}
      onSelect={(id) => {
        setSheetOpen(false);
        void open(id);
      }}
      onDeleted={(id) => {
        if (id === threadId) newChat();
      }}
    />
  );

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden space-y-2 md:block" aria-label="Conversations">
        <Button variant="outline" className="w-full" onClick={() => newChat()}>
          <MessageSquarePlus /> New chat
        </Button>
        {list}
      </aside>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex gap-2 md:hidden">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-11 flex-1">
                  <MessagesSquare /> Conversations
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 max-w-[85vw] space-y-3 p-4">
                <SheetHeader>
                  <SheetTitle>Conversations</SheetTitle>
                </SheetHeader>
                {list}
              </SheetContent>
            </Sheet>
            <Button variant="outline" className="h-11 flex-1" onClick={() => newChat()}>
              <MessageSquarePlus /> New chat
            </Button>
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Focus">
            {LENS_IDS.map((id) => (
              <Button
                key={id}
                variant={lens === id ? "default" : "outline"}
                size="sm"
                className="h-11 shrink-0 md:h-8"
                aria-pressed={lens === id}
                onClick={() => (id === lens ? undefined : newChat(id))}
              >
                {LENSES[id].label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{LENSES[lens].description}</p>

          {loading && <Skeleton className="h-32 w-full rounded-xl" aria-busy />}
          {!loading && msgs.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Ask anything. Changes are only ever proposed; you apply them.
              </p>
              <div className="flex flex-wrap gap-2">
                {LENSES[lens].starters.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-11 py-2 text-left whitespace-normal md:min-h-8"
                    onClick={() => send(s)}
                    disabled={busy}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {msgs.length > 0 && (
            <ul className="space-y-3" data-testid="assistant-chat" aria-live="polite">
              {msgs.map((m) => (
                <li
                  key={m.key}
                  className={m.role === "user" ? "ml-8 rounded-2xl bg-surface-2 px-3 py-2 text-sm" : "space-y-2"}
                >
                  {m.role === "user" ? (
                    m.content
                  ) : (
                    <>
                      {m.content ? (
                        <MarkdownLite text={m.content} />
                      ) : (
                        busy && m.proposals.length === 0 && <Loader2 className="animate-spin" aria-label="Thinking" />
                      )}
                      {m.proposals.map((p) => (
                        <ProposalCard key={p.id} proposal={p} />
                      ))}
                      {(m.model || m.costMicros != null) && (
                        <p className="text-xs text-muted-foreground">
                          {[m.model, m.costMicros != null ? cost(m.costMicros) : null].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </>
                  )}
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
          {config?.webSearch && (
            <div className="flex items-center gap-2">
              <Checkbox id="chat-web" checked={web} onCheckedChange={(v) => setWeb(v === true)} />
              <Label htmlFor="chat-web" className="text-sm font-normal">
                Compare with public data
              </Label>
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <Input
              aria-label="Message the assistant"
              placeholder="Ask about your money…"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              className="h-11 md:h-9"
            />
            <Button
              type="submit"
              size="icon"
              className="size-11 shrink-0 md:size-9"
              disabled={busy || !text.trim()}
              aria-label="Send"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
