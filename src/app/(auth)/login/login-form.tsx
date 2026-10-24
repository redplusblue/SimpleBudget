"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const mins = Math.max(1, Math.ceil((data.retryAfterSeconds ?? 60) / 60));
        setError(`Too many attempts. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
      } else if (res.status === 401) {
        setError("Incorrect password.");
      } else if (res.status === 409) {
        router.replace("/setup");
        return;
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Enter your password to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              className="h-11 md:h-9"
            />
          </div>
          {error && (
            <p id="login-error" role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || !password}
            className="bg-brand-gradient h-11 w-full text-white md:h-9"
          >
            {busy && <Loader2 className="animate-spin" />} Log in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
