"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConnectSimpleFinForm } from "@/components/connect-simplefin-form";
import { ImportStep } from "./import-step";
import { AccountsStep } from "./accounts-step";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const STEPS = ["Password", "Connect", "Import", "Accounts"] as const;
export type SetupStep = "password" | "connect" | "import" | "accounts";
const STEP_INDEX: Record<SetupStep, number> = { password: 0, connect: 1, import: 2, accounts: 3 };
const MIN_LENGTH = 10;

export function SetupWizard({ step }: { step: SetupStep }) {
  const index = STEP_INDEX[step];
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
            <span className={cn("hidden sm:inline", i === index && "inline font-medium text-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-0.5 h-px w-4 bg-border sm:mx-1 sm:w-6" />}
          </li>
        ))}
      </ol>
      {step === "password" && <PasswordStep />}
      {step === "connect" && <ConnectStep />}
      {step === "import" && <ImportStep />}
      {step === "accounts" && <AccountsStep />}
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

function ConnectStep() {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connect SimpleFIN</CardTitle>
        <CardDescription>Link your accounts to start importing balances and transactions.</CardDescription>
      </CardHeader>
      <CardContent>
        <ConnectSimpleFinForm onConnected={() => router.refresh()} />
      </CardContent>
    </Card>
  );
}
