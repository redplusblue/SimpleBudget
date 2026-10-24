"use client";

import { useQuery } from "@tanstack/react-query";
import type { AccountGroup } from "@/lib/finance/accounts-overview";
import type { CategoryOption } from "@/lib/finance/taxonomy";
import type { TagChip } from "@/lib/finance/transaction-types";
import { fetchJson } from "@/lib/fetch-json";

export const CATEGORIES_KEY = ["categories"] as const;
export const TAGS_KEY = ["tags"] as const;
export const ACCOUNTS_OVERVIEW_KEY = ["accounts-overview"] as const;

export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async () => (await fetchJson<{ categories: CategoryOption[] }>("/api/categories")).categories,
    staleTime: 5 * 60_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: TAGS_KEY,
    queryFn: async () => (await fetchJson<{ tags: TagChip[] }>("/api/tags")).tags,
    staleTime: 5 * 60_000,
  });
}

export function useAccountsOverview() {
  return useQuery({
    queryKey: ACCOUNTS_OVERVIEW_KEY,
    queryFn: async () => (await fetchJson<{ groups: AccountGroup[] }>("/api/accounts/overview")).groups,
    staleTime: 30_000,
  });
}
