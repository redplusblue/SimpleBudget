import { PageHeader } from "@/components/page-header";
import { AccountsOverview } from "./accounts-overview";

export const metadata = { title: "Accounts" };

export default function AccountsPage() {
  return (
    <>
      <PageHeader title="Accounts" description="Balances across everything you've connected." />
      <AccountsOverview />
    </>
  );
}
