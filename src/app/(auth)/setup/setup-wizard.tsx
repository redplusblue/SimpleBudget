"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConnectSimpleFinForm } from "@/components/connect-simplefin-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const STEPS = ["Password", "Connect"] as const;
const MIN_LENGTH = 10;

export function SetupWizard({ step, connectionCount }: { step: "password" | "connect"; connectionCount: number }) {
  const index = step === "password" ? 0 : 1;
  return (
    <div className="space-y-4">
      <ol className="flex items-center justify-center gap-2 text-xs text-muted-foreground" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === index ? "step" : undefined} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border border-border font-medium",
                i < index && "border-primary bg-primary text-primary-foreground",
                i === index && "border-primary text-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={cn(i === index && "font-medium text-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>
      {step === "password" ? <PasswordStep /> : <ConnectStep connectionCount={connectionCount} />}
    </div>
  );
}

function PasswordStep() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok || res.status === 409) {
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Couldn't save the password.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your password</CardTitle>
        <CardDescription>
          This protects your dashboard. There&apos;s only one user, so there&apos;s no username.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 md:h-9"
            />
            <p className="text-xs text-muted-foreground">At least {MIN_LENGTH} characters.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11 md:h-9"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || !password}
            className="bg-brand-gradient h-11 w-full text-white md:h-9"
          >
            {busy && <Loader2 className="animate-spin" />} Continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ConnectStep({ connectionCount }: { connectionCount: number }) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/complete", { method: "POST" });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError("Couldn't finish setup. Connect SimpleFIN first.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connect SimpleFIN</CardTitle>
        <CardDescription>Link your accounts to start importing balances and transactions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {connectionCount > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" />
            <p>
              SimpleFIN connected. You can add another token below, or finish setup. Your first sync will be available
              soon.
            </p>
          </div>
        )}
        <ConnectSimpleFinForm onConnected={() => router.refresh()} />
        {connectionCount > 0 && (
          <>
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <Button variant="outline" onClick={finish} disabled={finishing} className="h-11 w-full md:h-9">
              {finishing && <Loader2 className="animate-spin" />} Finish setup
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
