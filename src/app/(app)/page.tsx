import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <>
      <PageHeader title="Dashboard" />
      <EmptyState
        icon={LayoutDashboard}
        title="Your net worth and monthly overview will show up here once accounts are connected."
      />
    </>
  );
}
