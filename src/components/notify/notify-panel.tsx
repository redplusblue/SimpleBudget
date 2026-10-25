"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { centsToDecimalString, parseCents } from "@/lib/finance/cents";
import type { NotifyConfig, NotifyKind } from "@/lib/notify/config";

const KEY = ["notify-config"] as const;

export function NotifyPanel() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => (await fetchJson<{ config: NotifyConfig }>("/api/settings/notifications")).config,
  });
  const cfg = query.data;

  const [enabled, setEnabled] = useState(false);
  const [kind, setKind] = useState<NotifyKind>("ntfy");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [large, setLarge] = useState("500");
  const [onLarge, setOnLarge] = useState(true);
  const [onFailure, setOnFailure] = useState(true);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg) return;
    setEnabled(cfg.enabled);
    setKind(cfg.kind);
    setLarge(centsToDecimalString(cfg.largeCents).replace(/\.00$/, ""));
    setOnLarge(cfg.onLarge);
    setOnFailure(cfg.onFailure);
    setDetails(cfg.details);
  }, [cfg]);

  const save = useMutation({
    mutationFn: async (extra: { url?: string | null; token?: string | null; enabled?: boolean } = {}) => {
      let largeCents: number;
      try {
        largeCents = Math.abs(parseCents(large.trim().replace(/^\$/, "")));
      } catch {
        throw new Error("Enter the amount like 500 or 500.00");
      }
      return fetchJson(
        "/api/settings/notifications",
        jsonBody("PUT", { enabled, kind, largeCents, onLarge, onFailure, details, ...extra }),
      );
    },
    onSuccess: () => {
      setUrl("");
      setToken("");
      setError(null);
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Alert settings saved");
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save the settings"),
  });

  const test = useMutation({
    mutationFn: () => fetchJson("/api/settings/notifications/test", { method: "POST" }),
    onSuccess: () => toast.success("Sent. Check your device."),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "The test failed"),
  });

  if (query.isPending) return <Skeleton className="h-96 w-full rounded-2xl" aria-busy />;
  if (query.isError || !cfg)
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <span className="text-negative">Couldn&apos;t load the alert settings.</span>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
        <CardDescription>
          Get a push message when a sync fails or a large transaction comes in. Works with ntfy or any server that
          accepts a JSON webhook.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate({
              ...(url.trim() ? { url: url.trim() } : {}),
              ...(token.trim() ? { token: token.trim() } : {}),
            });
          }}
        >
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
            <div>
              <Label htmlFor="n-enabled">Send alerts</Label>
              <p className="text-xs text-muted-foreground">Checked after every sync.</p>
            </div>
            <Switch id="n-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label>Send through</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as NotifyKind)}>
              <SelectTrigger aria-label="Send through" className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ntfy">ntfy (a topic address)</SelectItem>
                <SelectItem value="webhook">Webhook (JSON)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="n-url">{kind === "ntfy" ? "Topic address" : "Webhook address"}</Label>
            <Input
              id="n-url"
              type="password"
              autoComplete="off"
              placeholder={
                cfg.hasUrl
                  ? `Saved (${cfg.host ?? "unreadable"}). Paste a new address to replace it`
                  : kind === "ntfy"
                    ? "https://ntfy.sh/your-long-private-topic"
                    : "https://example.com/hooks/simplebudget"
              }
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-11 md:h-9"
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted. A topic name is like a password: anyone who knows it can read your alerts, so make it
              long and random.
            </p>
            {cfg.hasUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2"
                disabled={save.isPending}
                onClick={() => save.mutate({ url: null, token: null, enabled: false })}
              >
                Remove the saved address (turns alerts off)
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="n-token">Access token (optional)</Label>
            <Input
              id="n-token"
              type="password"
              autoComplete="off"
              placeholder={cfg.hasToken ? "Saved. Type a new one to replace it" : "Only if your server needs one"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="h-11 md:h-9"
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium">Tell me about</legend>
            <div className="flex items-start gap-3">
              <Checkbox
                id="n-fail"
                checked={onFailure}
                onCheckedChange={(v) => setOnFailure(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="n-fail" className="font-normal">
                Sync problems (at most once every 6 hours)
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="n-large"
                checked={onLarge}
                onCheckedChange={(v) => setOnLarge(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="n-large" className="font-normal">
                Large transactions of at least
              </Label>
              <Input
                aria-label="Large transaction amount in dollars"
                inputMode="decimal"
                value={large}
                onChange={(e) => setLarge(e.target.value)}
                className="-mt-1.5 h-9 w-24 text-right"
              />
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="n-details"
                checked={details}
                onCheckedChange={(v) => setDetails(v === true)}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="n-details" className="font-normal">
                  Include the payee and account in the message
                </Label>
                <p className="text-xs text-muted-foreground">
                  Off by default: messages just say a large amount came in or went out. Only turn this on for a private
                  server.
                </p>
              </div>
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              disabled={test.isPending || !cfg.hasUrl}
              onClick={() => test.mutate()}
            >
              {test.isPending ? <Loader2 className="animate-spin" /> : <BellRing />} Send a test
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
