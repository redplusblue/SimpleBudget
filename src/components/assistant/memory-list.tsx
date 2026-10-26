"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { Memory } from "@/lib/ai/memory";

export const MEMORIES_KEY = ["ai-memories"] as const;

function Row({ m }: { m: Memory }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const refresh = () => qc.invalidateQueries({ queryKey: MEMORIES_KEY });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Couldn't save that");
  const patch = useMutation({
    mutationFn: (body: { text?: string; enabled?: boolean }) =>
      fetchJson(`/api/ai/memories/${m.id}`, jsonBody("PATCH", body)),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => fetchJson(`/api/ai/memories/${m.id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail,
  });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2" data-testid="memory">
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            patch.mutate({ text });
          }}
        >
          <Input
            aria-label="Memory text"
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            className="h-11 md:h-9"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0 md:size-9"
            aria-label="Save memory"
            disabled={patch.isPending}
          >
            <Check />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 md:size-9"
            aria-label="Cancel editing"
            onClick={() => {
              setEditing(false);
              setText(m.text);
            }}
          >
            <X />
          </Button>
        </form>
      ) : (
        <>
          <span
            className={`min-w-0 flex-1 text-sm break-words ${m.enabled ? "" : "text-muted-foreground line-through"}`}
          >
            {m.text}
            {m.source === "assistant" && (
              <Badge variant="outline" className="ml-2">
                from chat
              </Badge>
            )}
          </span>
          <Switch
            checked={m.enabled}
            onCheckedChange={(enabled) => patch.mutate({ enabled })}
            aria-label={`Use this memory: ${m.text}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-9"
            aria-label={`Edit memory: ${m.text}`}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-9"
            aria-label={`Delete memory: ${m.text}`}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </li>
  );
}

export function MemoryList() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: MEMORIES_KEY,
    queryFn: async () => (await fetchJson<{ memories: Memory[] }>("/api/ai/memories")).memories,
  });
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => fetchJson("/api/ai/memories", jsonBody("POST", { text })),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: MEMORIES_KEY });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't add that"),
  });

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Things the AI should always know about you. <strong>These are sent with every AI request.</strong> Memories
          proposed in chats appear here after you apply them.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
        >
          <Input
            aria-label="New memory"
            placeholder="e.g. Rent is paid to Acme on the 1st"
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            className="h-11 md:h-9"
          />
          <Button type="submit" className="h-11 shrink-0 md:h-9" disabled={add.isPending || !text.trim()}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add
          </Button>
        </form>
        {query.isPending && <Skeleton className="h-24 w-full rounded-xl" aria-busy />}
        {query.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load your memories.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No memories yet.</p>}
        {query.data && query.data.length > 0 && (
          <ul className="divide-y divide-border" aria-label="Memories">
            {query.data.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
