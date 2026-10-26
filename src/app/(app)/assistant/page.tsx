import { Suspense } from "react";
import { AssistantPage } from "@/components/assistant/assistant-page";

export const metadata = { title: "Assistant" };

export default function Page() {
  return (
    <Suspense>
      <AssistantPage />
    </Suspense>
  );
}
