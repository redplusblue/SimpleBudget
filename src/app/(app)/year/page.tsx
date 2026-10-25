import { Suspense } from "react";
import { YearPage } from "@/components/year/year-page";

export const metadata = { title: "Year in review" };

export default function Page() {
  return (
    <Suspense>
      <YearPage />
    </Suspense>
  );
}
