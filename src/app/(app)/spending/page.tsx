import { Suspense } from "react";
import { getDb } from "@/db/client";
import { SpendingPage } from "@/components/spending/spending-page";
import { parseRange, rangeQuery } from "@/components/spending/range-state";
import { getEnv } from "@/lib/env";
import { currentMonth } from "@/lib/finance/dates";
import { getSpendingReport } from "@/lib/finance/spending-report";

export const metadata = { title: "Spending" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const { TZ } = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const range = parseRange(params, currentMonth(now, TZ));
  // The first report is computed here so the page arrives with its numbers; the client takes over after that.
  let initial: { key: string; report: ReturnType<typeof getSpendingReport> } | undefined;
  try {
    initial = {
      key: rangeQuery(range),
      report: getSpendingReport(
        getDb(),
        range.kind === "month" ? { month: range.month } : { from: range.from, to: range.to },
        now,
        TZ,
      ),
    };
  } catch {
    initial = undefined; // an invalid custom range: the client shows its own message
  }
  return (
    <Suspense>
      <SpendingPage initial={initial} />
    </Suspense>
  );
}
