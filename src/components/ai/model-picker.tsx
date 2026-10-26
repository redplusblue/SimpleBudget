"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AiFeature } from "@/lib/llm/models";
import { useAiConfig } from "./ai-config";

/** A per-request model choice. The parent keeps the state and sends it with the request; nothing is saved. */
export function ModelPicker(props: {
  feature: AiFeature;
  value: string | undefined;
  onChange: (id: string) => void;
  className?: string;
}) {
  const { data } = useAiConfig();
  if (!data || data.models.length < 2) return null;
  const value = props.value ?? data.featureModels[props.feature] ?? data.model;
  return (
    <Select value={value} onValueChange={props.onChange}>
      <SelectTrigger aria-label="Model for this request" className={cn("h-11 max-w-full md:h-9", props.className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {data.models.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label ?? m.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
