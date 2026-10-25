"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ACCOUNTS_OVERVIEW_KEY } from "./use-lookups";

/** After anything that changes transactions or balances: every view that shows money refetches. */
export function useRefreshMoney() {
  const qc = useQueryClient();
  return useCallback(() => {
    for (const key of [
      ["transactions"],
      ["transaction"],
      ["account"],
      ["splits"],
      ["dashboard"],
      ["spending"],
      ["targets"],
      ["insights"],
      ["networth"],
      ACCOUNTS_OVERVIEW_KEY,
    ])
      qc.invalidateQueries({ queryKey: key });
  }, [qc]);
}
