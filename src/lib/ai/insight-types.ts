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
  pinned: boolean;
  createdAt: number;
}
