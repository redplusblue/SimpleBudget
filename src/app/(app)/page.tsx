import { Dashboard } from "@/components/dashboard/dashboard";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <Dashboard />
    </>
  );
}
