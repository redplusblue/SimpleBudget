import { Suspense } from "react";
import { SpendingPage } from "@/components/spending/spending-page";

export const metadata = { title: "Spending" };

export default function Page() {
  return (
    <Suspense>
      <SpendingPage />
    </Suspense>
  );
}
