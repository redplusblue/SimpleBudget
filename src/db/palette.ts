/** Categorical chart palette; categories and tags take colors from here in order. */
export const CHART_PALETTE = [
  "#6366F1",
  "#22D3EE",
  "#F472B6",
  "#F59E0B",
  "#10B981",
  "#A78BFA",
  "#FB7185",
  "#84CC16",
  "#38BDF8",
  "#FACC15",
] as const;

export function paletteColor(index: number): string {
  return CHART_PALETTE[((index % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}
