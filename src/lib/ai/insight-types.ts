// Client-safe: one generated insight card as the UI sees it.

export interface InsightCardView {
  id: number;
  batch: number;
  lens: string;
  model: string | null;
  severity: "info" | "good" | "warn";
  title: string;
  body: string;
  link: string | null;
  /** https sources for public-data facts; links come from the provider's citations only. */
  sources: Array<{ url: string; title?: string }>;
  pinned: boolean;
  createdAt: number;
}
