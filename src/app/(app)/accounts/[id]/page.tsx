import { CreditCard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Account" };

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Account" description={decodeURIComponent(id)} />
      <EmptyState icon={CreditCard} title="This account's register will appear here." />
    </>
  );
}
