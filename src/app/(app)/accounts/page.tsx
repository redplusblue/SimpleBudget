import { CreditCard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Accounts" };

export default function Page() {
  return (
    <>
      <PageHeader title="Accounts" />
      <EmptyState icon={CreditCard} title="Connected accounts will be listed here." />
    </>
  );
}
