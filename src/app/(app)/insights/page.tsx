import { Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Insights" };

export default function Page() {
  return (
    <>
      <PageHeader title="Insights" />
      <EmptyState icon={Lightbulb} title="Insights about your spending will appear here." />
    </>
  );
}
