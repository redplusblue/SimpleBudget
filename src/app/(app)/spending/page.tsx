import { PieChart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Spending" };

export default function Page() {
  return (
    <>
      <PageHeader title="Spending" />
      <EmptyState icon={PieChart} title="Spending analytics will appear here once transactions are synced." />
    </>
  );
}
