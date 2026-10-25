import { Suspense } from "react";
import { getDb } from "@/db/client";
import { PageHeader } from "@/components/page-header";
import { Register } from "@/components/register/register";
import { getEnv } from "@/lib/env";
import { filtersFromSearchParams, filtersToSearchParams } from "@/lib/finance/transaction-params";
import { queryTransactions } from "@/lib/finance/transactions-query";

export const metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const filters = filtersFromSearchParams(params);
  // The first page of the register is read here so the page arrives with its rows.
  const initial = {
    qs: filtersToSearchParams(filters).toString(),
    page: queryTransactions(getDb(), filters, { limit: 100, timeZone: getEnv().TZ }),
  };
  return (
    <>
      <PageHeader title="Transactions" description="Everything across your accounts." />
      <Suspense>
        <Register initial={initial} />
      </Suspense>
    </>
  );
}
