import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { isAuthenticated } from "@/lib/auth";
import { count } from "drizzle-orm";
import { accounts } from "@/db/schema";
import { listConnections } from "@/lib/connections";
import { getSetupState } from "@/lib/setup";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const db = getDb();
  const state = getSetupState(db);
  if (state === "complete") redirect("/");
  if (state === "needs-password") return <SetupWizard step="password" />;
  if (!(await isAuthenticated())) redirect("/login");
  if (listConnections(db).length === 0) return <SetupWizard step="connect" />;
  const accountCount = db.select({ n: count() }).from(accounts).get()?.n ?? 0;
  return <SetupWizard step={accountCount === 0 ? "import" : "accounts"} />;
}
