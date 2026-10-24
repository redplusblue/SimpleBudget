import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Register } from "@/components/register/register";

export const metadata = { title: "Transactions" };

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transactions" description="Everything across your accounts." />
      <Suspense>
        <Register />
      </Suspense>
    </>
  );
}
