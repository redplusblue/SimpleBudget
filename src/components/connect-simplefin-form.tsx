"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Pastes a SimpleFIN setup token and claims it. Shared by the setup wizard and Settings. */
export function ConnectSimpleFinForm({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken: token }),
      });
      if (res.ok) {
        setToken("");
        onConnected();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Couldn't connect. Please try again.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        SimpleFIN Bridge securely links your banks. Create a <strong>setup token</strong> at{" "}
        <a
          href="https://bridge.simplefin.org"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
        >
          bridge.simplefin.org <ExternalLink className="size-3" />
        </a>{" "}
        and paste it below. A token can only be used once.
      </p>
      <div className="space-y-2">
        <Label htmlFor="setup-token">Setup token</Label>
        <Textarea
          id="setup-token"
          required
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "token-error" : undefined}
          className="font-mono text-xs"
        />
      </div>
      {error && (
        <p id="token-error" role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={busy || !token.trim()}
        className="bg-brand-gradient h-11 w-full text-white md:h-9"
      >
        {busy && <Loader2 className="animate-spin" />} Connect
      </Button>
    </form>
  );
}
