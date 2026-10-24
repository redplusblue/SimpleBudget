import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsNav />
      <div className="max-w-2xl">{children}</div>
    </>
  );
}
