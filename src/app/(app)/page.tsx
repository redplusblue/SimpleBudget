import { getDb } from "@/db/client";
import { Dashboard } from "@/components/dashboard/dashboard";
import { PageHeader } from "@/components/page-header";
import { getEnv } from "@/lib/env";
import { getDashboard } from "@/lib/finance/dashboard";

export const metadata = { title: "Dashboard" };
// The numbers change with every sync, so this page is rendered per request.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const initial = getDashboard(getDb(), { now: Math.floor(Date.now() / 1000), timeZone: getEnv().TZ });
  return (
    <>
      <PageHeader title="Dashboard" />
      <Dashboard initialData={initial} />
    </>
  );
}
