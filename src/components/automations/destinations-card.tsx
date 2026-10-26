"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { DestinationView } from "@/lib/automations/destinations";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";

export const DESTINATIONS_KEY = ["automation-destinations"] as const;

export function useDestinations() {
  return useQuery({
    queryKey: DESTINATIONS_KEY,
    queryFn: async () =>
      (await fetchJson<{ destinations: DestinationView[] }>("/api/automations/destinations")).destinations,
  });
}

const KIND_LABEL = { ntfy: "ntfy", webhook: "Webhook", discord: "Discord" } as const;

export function DestinationsCard() {
  const qc = useQueryClient();
  const query = useDestinations();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DestinationView["kind"]>("discord");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: DESTINATIONS_KEY });
  const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof ApiError ? e.message : fallback);

  const add = useMutation({
    mutationFn: () =>
      fetchJson(
        "/api/automations/destinations",
        jsonBody("POST", { name, kind, url, ...(token.trim() && kind !== "discord" ? { token: token.trim() } : {}) }),
      ),
    onSuccess: () => {
      setAdding(false);
      setName("");
      setUrl("");
      setToken("");
      setError(null);
      refresh();
      toast.success("Destination added");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't add that"),
  });
  const test = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/automations/destinations/${id}/test`, { method: "POST" }),
    onSuccess: () => toast.success("Sent. Check the destination."),
    onError: fail("The test failed"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/automations/destinations/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    onError: fail("Couldn't delete that"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destinations</CardTitle>
        <CardDescription>
          Where automations send things. Addresses are stored encrypted and never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending && <Skeleton className="h-16 w-full rounded-xl" aria-busy />}
        {query.isError && (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-negative">Couldn&apos;t load destinations.</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {query.data?.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No destinations yet. Add one to start an automation.</p>
        )}
        {query.data && query.data.length > 0 && (
          <ul className="divide-y divide-border" aria-label="Destinations">
            {query.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="destination">
                <span className="min-w-0 flex-1 text-sm break-words">
                  <strong>{d.name}</strong>{" "}
                  <span className="text-muted-foreground">
                    {KIND_LABEL[d.kind]} · {d.host ?? "unreadable"}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 md:h-8"
                  onClick={() => test.mutate(d.id)}
                  disabled={test.isPending}
                  aria-label={`Send a test to ${d.name}`}
                >
                  <Send /> Test
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 md:size-8"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => remove.mutate(d.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <form
            className="space-y-3 rounded-xl border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              add.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="dest-name">Name</Label>
              <Input
                id="dest-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                className="h-11 md:h-9"
                placeholder="e.g. My Discord"
              />
            </div>
            <div className="space-y-1">
              <Label>Send through</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as DestinationView["kind"])}>
                <SelectTrigger aria-label="Send through" className="h-11 w-full md:h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="discord">Discord (webhook)</SelectItem>
                  <SelectItem value="ntfy">ntfy (a topic address)</SelectItem>
                  <SelectItem value="webhook">Webhook (JSON)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dest-url">Address</Label>
              <Input
                id="dest-url"
                type="password"
                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-11 md:h-9"
                placeholder={kind === "discord" ? "https://discord.com/api/webhooks/…" : "https://…"}
              />
              {kind === "discord" && (
                <p className="text-xs text-muted-foreground">Server Settings → Integrations → Webhooks → Copy URL.</p>
              )}
            </div>
            {kind !== "discord" && (
              <div className="space-y-1">
                <Label htmlFor="dest-token">Access token (optional)</Label>
                <Input
                  id="dest-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="h-11 md:h-9"
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 md:h-9" disabled={add.isPending || !name.trim() || !url.trim()}>
                {add.isPending && <Loader2 className="animate-spin" />} Add destination
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" className="h-11 md:h-9" onClick={() => setAdding(true)}>
            <Plus /> Add destination
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
