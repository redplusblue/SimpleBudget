"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Info, Loader2, Pin, PinOff, Sparkles, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAiConfig } from "@/components/ai/ai-config";
import { ModelPicker } from "@/components/ai/model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import type { InsightCardView } from "@/lib/ai/insight-types";
import { LENSES, LENS_IDS } from "@/lib/ai/lenses";

const KEY = ["ai-insight-cards"] as const;

const SEVERITY = {
  warn: { label: "Heads up", icon: AlertTriangle },
  good: { label: "Good news", icon: ThumbsUp },
  info: { label: "Note", icon: Info },
} as const;

function CardItem({ card }: { card: InsightCardView }) {
  const qc = useQueryClient();
  const sev = SEVERITY[card.severity];
  const patch = useMutation({
    mutationFn: (body: { pinned?: boolean; dismissed?: boolean }) =>
      fetchJson(`/api/ai/insights/${card.id}`, jsonBody("PATCH", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: () => toast.error("Couldn't update that card"),
  });
  return (
    <li className="space-y-2 rounded-2xl border border-border p-3" data-testid="insight-card">
      <div className="flex items-start justify-between gap-2">
        <Badge variant={card.severity === "warn" ? "destructive" : "secondary"}>
          <sev.icon aria-hidden /> {sev.label}
        </Badge>
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            aria-label={card.pinned ? `Unpin: ${card.title}` : `Pin: ${card.title}`}
            onClick={() => patch.mutate({ pinned: !card.pinned })}
          >
            {card.pinned ? <PinOff /> : <Pin />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            aria-label={`Dismiss: ${card.title}`}
            onClick={() => patch.mutate({ dismissed: true })}
          >
            <X />
          </Button>
        </div>
      </div>
      <p className="font-medium break-words">{card.title}</p>
      <p className="text-sm break-words text-muted-foreground">{card.body}</p>
      {card.sources.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Sources">
          {card.sources.map((src) => (
            <li key={src.url} className="break-words">
              Source:{" "}
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-link underline-offset-4 hover:underline"
              >
                {src.title || new URL(src.url).hostname}
              </a>{" "}
              ({new URL(src.url).hostname.replace(/^www\./, "")})
            </li>
          ))}
        </ul>
      )}
      {card.link?.startsWith("/") && (
        <Link href={card.link} className="inline-block text-sm text-link underline-offset-4 hover:underline">
          Open
        </Link>
      )}
    </li>
  );
}

export function InsightCards() {
  const qc = useQueryClient();
  const [lens, setLens] = useState<string>("all");
  const [model, setModel] = useState<string>();
  const [showEarlier, setShowEarlier] = useState(false);
  const [empty, setEmpty] = useState(false);
  const { data: config } = useAiConfig();
  const [web, setWeb] = useState(false);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ cards: InsightCardView[] }>("/api/ai/insights?limit=60")).cards,
  });
  const generate = useMutation({
    mutationFn: () =>
      fetchJson<{ cards: InsightCardView[] }>(
        "/api/ai/insights",
        jsonBody("POST", { lens, ...(model ? { model } : {}), ...(web && config?.webSearch ? { web: true } : {}) }),
      ),
    onSuccess: (r) => {
      setEmpty(r.cards.length === 0);
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["ai-usage"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't generate insights"),
  });

  const { pinned, latest, earlier } = useMemo(() => {
    const cards = query.data ?? [];
    const pinned = cards.filter((c) => c.pinned);
    const rest = cards.filter((c) => !c.pinned);
    const top = rest.reduce((m, c) => Math.max(m, c.batch), 0);
    return { pinned, latest: rest.filter((c) => c.batch === top), earlier: rest.filter((c) => c.batch !== top) };
  }, [query.data]);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Focus">
          {(["all", ...LENS_IDS.filter((l) => l !== "general")] as const).map((id) => (
            <Button
              key={id}
              variant={lens === id ? "default" : "outline"}
              size="sm"
              className="h-11 shrink-0 md:h-8"
              aria-pressed={lens === id}
              onClick={() => setLens(id)}
            >
              {id === "all" ? "Everything" : LENSES[id].label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModelPicker feature="insights" value={model} onChange={setModel} className="w-44" />
          <Button className="h-11 md:h-9" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate
          </Button>
          {config?.webSearch && (
            <div className="flex items-center gap-2">
              <Checkbox id="insights-web" checked={web} onCheckedChange={(v) => setWeb(v === true)} />
              <Label htmlFor="insights-web" className="text-sm font-normal">
                Compare with public data
              </Label>
            </div>
          )}
        </div>
        {empty && !generate.isPending && (
          <p className="text-sm text-muted-foreground" role="status">
            Nothing new worth a card right now.
          </p>
        )}

        {query.isPending && <Skeleton className="h-28 w-full rounded-2xl" aria-busy />}
        {query.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load your insights.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {query.isSuccess && query.data.length === 0 && !empty && (
          <p className="text-sm text-muted-foreground">
            Press Generate to get a few insights. Nothing runs until you do.
          </p>
        )}

        {pinned.length > 0 && (
          <section aria-label="Pinned" className="space-y-2">
            <h3 className="text-sm font-medium">Pinned</h3>
            <ul className="space-y-2">
              {pinned.map((c) => (
                <CardItem key={c.id} card={c} />
              ))}
            </ul>
          </section>
        )}
        {latest.length > 0 && (
          <ul className="space-y-2" aria-label="Latest insights">
            {latest.map((c) => (
              <CardItem key={c.id} card={c} />
            ))}
          </ul>
        )}
        {earlier.length > 0 && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => setShowEarlier((v) => !v)}
              aria-expanded={showEarlier}
            >
              <ChevronDown className={showEarlier ? "rotate-180" : ""} /> Earlier ({earlier.length})
            </Button>
            {showEarlier && (
              <ul className="mt-2 space-y-2" aria-label="Earlier insights">
                {earlier.map((c) => (
                  <CardItem key={c.id} card={c} />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
