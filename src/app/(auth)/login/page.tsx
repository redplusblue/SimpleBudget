import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { isAuthenticated } from "@/lib/auth";
import { sanitizeNextPath } from "@/lib/auth/next-path";
import { getSetupState } from "@/lib/setup";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = sanitizeNextPath((await searchParams).next);
  if (getSetupState(getDb()) === "needs-password") redirect("/setup");
  if (await isAuthenticated()) redirect(next);
  return <LoginForm next={next} />;
}
