import { AiSettingsPanel } from "@/components/ai/ai-settings-panel";
import { AiUsageCard } from "@/components/ai/ai-usage-card";

export const metadata = { title: "AI" };

export default function AiSettingsPage() {
  return (
    <div className="space-y-6">
      <AiSettingsPanel />
      <AiUsageCard />
    </div>
  );
}
