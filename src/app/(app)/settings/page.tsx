import { Settings } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Settings" };

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState icon={Settings} title="Connections, sync, categories and more will be configured here." />
    </>
  );
}
