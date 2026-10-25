import { Suspense } from "react";
import { RulesPage } from "./rules-page";

export const metadata = { title: "Rules" };

export default function Page() {
  return (
    <Suspense>
      <RulesPage />
    </Suspense>
  );
}
