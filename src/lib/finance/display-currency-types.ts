/** Client-safe: the display-currency choices and the shape the UI receives. */

/** Shown first in the picker, in this order (only those with a rate are offered). */
export const TOP_CURRENCIES = ["USD", "INR", "GBP", "CAD", "MXN", "EUR", "AUD", "JPY", "CNY", "CHF"] as const;

export interface DisplayCurrencyState {
  /** The toggle. Off means everything is US dollars and the top-bar button is hidden. */
  enabled: boolean;
  /** The chosen currency; always "USD" when disabled or when there is no usable rate. */
  code: string;
  /** Units of `code` per 1 US dollar (1 for USD). */
  rate: number;
  /** When the rates were last fetched (unix seconds), or null if never. */
  updatedAt: number | null;
  /** Every currency we have a rate for, USD included, sorted by code. */
  available: string[];
}
