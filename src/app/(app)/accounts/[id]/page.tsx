import { Suspense } from "react";
import { AccountPage } from "./account-page";

export const metadata = { title: "Account" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AccountPage id={decodeURIComponent(id)} />
    </Suspense>
  );
}
