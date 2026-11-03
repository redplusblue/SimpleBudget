import { redirect } from "next/navigation";
import { DisplayCurrencyProvider } from "@/components/currency/display-currency";
import { AppShell } from "@/components/shell/app-shell";
import { getDb } from "@/db/client";
import { isAuthenticated } from "@/lib/auth";
import { getDisplayCurrency } from "@/lib/finance/exchange-rates";
import { getSetupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (getSetupState(getDb()) !== "complete") redirect("/setup");
  if (!(await isAuthenticated())) redirect("/login");
  return (
    <DisplayCurrencyProvider initial={getDisplayCurrency(getDb())}>
      <AppShell>{children}</AppShell>
    </DisplayCurrencyProvider>
  );
}
