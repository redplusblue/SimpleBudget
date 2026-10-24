import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getDb } from "@/db/client";
import { isAuthenticated } from "@/lib/auth";
import { getSetupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (getSetupState(getDb()) !== "complete") redirect("/setup");
  if (!(await isAuthenticated())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
