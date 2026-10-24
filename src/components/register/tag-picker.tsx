"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TAGS_KEY, useTags } from "@/hooks/use-lookups";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import type { TagChip } from "@/lib/finance/transaction-types";

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => fetchJson<{ tag: TagChip }>("/api/tags", jsonBody("POST", { name })),
    onSuccess: ({ tag }) => {
      qc.setQueryData<TagChip[]>(TAGS_KEY, (prev = []) =>
        prev.some((t) => t.id === tag.id) ? prev : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
    onError: () => toast.error("Couldn't create that tag"),
  });
}

/**
 * Searchable tag list with "create" on Enter. Selecting a tag calls `onPick`; whether that adds or
 * removes is up to the caller (the check mark shows `selectedIds`).
 */
export function TagPicker({
  selectedIds = [],
  onPick,
  children,
  align = "start",
}: {
  selectedIds?: number[];
  onPick: (tag: TagChip) => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: tags = [] } = useTags();
  const create = useCreateTag();
  const selected = new Set(selectedIds);
  const trimmed = query.trim();
  const exists = tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Find or create a tag…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{trimmed ? "No matching tags." : "No tags yet. Type a name to create one."}</CommandEmpty>
            <CommandGroup>
              {tags.map((t) => (
                <CommandItem key={t.id} value={t.name} onSelect={() => onPick(t)}>
                  <span aria-hidden className="size-2 rounded-full" style={{ background: t.color }} />
                  {t.name}
                  {selected.has(t.id) && <Check className="ml-auto size-4" aria-label="Selected" />}
                </CommandItem>
              ))}
              {trimmed && !exists && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={async () => {
                    const { tag } = await create.mutateAsync(trimmed);
                    setQuery("");
                    onPick(tag);
                  }}
                >
                  {create.isPending ? <Loader2 className="animate-spin" /> : null}
                  Create &ldquo;{trimmed}&rdquo;
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
