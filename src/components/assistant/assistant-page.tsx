"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAiConfig } from "@/components/ai/ai-config";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssistantChat } from "./assistant-chat";
import { InsightCards } from "./insight-cards";
import { MemoryList } from "./memory-list";

const TABS = ["insights", "chat", "memory"] as const;
type Tab = (typeof TABS)[number];

export function AssistantPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: config } = useAiConfig();
  const requested = params.get("tab");
  const tab: Tab = TABS.find((t) => t === requested) ?? "insights";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Insights written from facts your server computed, saved conversations, and things it should remember. Nothing
          runs until you press a button.
        </p>
      </div>

      {!config ? (
        <Skeleton className="h-40 w-full rounded-2xl" aria-busy />
      ) : !config.enabled ? (
        <p className="text-sm text-muted-foreground">
          The assistant needs AI turned on.{" "}
          <Link href="/settings/ai" className="text-link underline-offset-4 hover:underline">
            Set up AI
          </Link>{" "}
          (optional).
        </p>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(next) => {
            const url = new URLSearchParams(params.toString());
            url.set("tab", next);
            if (next !== "chat") url.delete("thread");
            router.replace(`/assistant?${url}`);
          }}
        >
          <TabsList>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
          </TabsList>
          <TabsContent value="insights">
            <InsightCards />
          </TabsContent>
          <TabsContent value="chat">
            <AssistantChat />
          </TabsContent>
          <TabsContent value="memory">
            <MemoryList />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
