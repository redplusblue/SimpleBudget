import { SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Rules" };

export default function Page() {
  return (
    <>
      <PageHeader title="Rules" />
      <EmptyState
        icon={SlidersHorizontal}
        title="Rules that categorize new transactions automatically will live here."
      />
    </>
  );
}
