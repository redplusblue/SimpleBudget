import { ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Transactions" };

export default function Page() {
  return (
    <>
      <PageHeader title="Transactions" />
      <EmptyState icon={ReceiptText} title="All of your transactions will be listed here." />
    </>
  );
}
