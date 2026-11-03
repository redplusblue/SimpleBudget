"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { fetchJson, jsonBody } from "@/lib/fetch-json";
import { formatCents, type FormatCentsOptions } from "@/lib/finance/cents";
import type { DisplayCurrencyState } from "@/lib/finance/display-currency-types";

const USD_ONLY: DisplayCurrencyState = { enabled: false, code: "USD", rate: 1, updatedAt: null, available: [] };

interface Ctx {
  state: DisplayCurrencyState;
  update: (patch: { enabled?: boolean; code?: string }) => Promise<void>;
  /** Replaces the state with what the server returned (after a refresh of the rates). */
  replace: (state: DisplayCurrencyState) => void;
}

const DisplayCurrencyContext = createContext<Ctx>({ state: USD_ONLY, update: async () => {}, replace: () => {} });

/** Holds the display currency for the whole app. Stored amounts stay US dollars; only what is drawn on screen converts. */
export function DisplayCurrencyProvider({
  initial,
  children,
}: {
  initial: DisplayCurrencyState;
  children: React.ReactNode;
}) {
  const [state, setState] = useState(initial);
  const update = useCallback(async (patch: { enabled?: boolean; code?: string }) => {
    setState(await fetchJson<DisplayCurrencyState>("/api/settings/display-currency", jsonBody("PUT", patch)));
  }, []);
  const value = useMemo(() => ({ state, update, replace: setState }), [state, update]);
  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

export const useDisplayCurrency = () => useContext(DisplayCurrencyContext);

/**
 * Like `formatCents`, but in the chosen display currency. An amount passed with a non-dollar `currency` is an account's
 * own currency and is shown as is; everything else is dollars and is converted.
 */
export function useFormatMoney(): (cents: number, opts?: FormatCentsOptions) => string {
  const { code, rate } = useDisplayCurrency().state;
  return useCallback(
    (cents, opts = {}) => {
      const native = opts.currency !== undefined && opts.currency !== "USD";
      if (native || code === "USD") return formatCents(cents, opts);
      return formatCents(Math.round(cents * rate), { ...opts, currency: code });
    },
    [code, rate],
  );
}
