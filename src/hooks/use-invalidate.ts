"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { CATEGORIES_KEY, TAGS_KEY } from "./use-lookups";

/** Everything that displays categories, tags or rules must refetch after they change. */
export function useInvalidateTaxonomy() {
  const qc = useQueryClient();
  return useCallback(() => {
    for (const key of [
      CATEGORIES_KEY,
      TAGS_KEY,
      ["categories-admin"],
      ["tags-admin"],
      ["rules"],
      ["transactions"],
      ["dashboard"],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
  }, [qc]);
}
