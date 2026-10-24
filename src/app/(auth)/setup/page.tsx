import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { isAuthenticated } from "@/lib/auth";
import { listConnections } from "@/lib/connections";
import { getSetupState } from "@/lib/setup";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const db = getDb();
  const state = getSetupState(db);
  if (state === "complete") redirect("/");
  if (state === "needs-password") return <SetupWizard step="password" connectionCount={0} />;
  if (!(await isAuthenticated())) redirect("/login");
  return <SetupWizard step="connect" connectionCount={listConnections(db).length} />;
}
