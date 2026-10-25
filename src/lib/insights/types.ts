// Client-safe: the shape of one insight card.

export type InsightSeverity = "info" | "good" | "warn";

export interface Insight {
  /** Stable for the same finding (e.g. `category-up:12:2026-10`), so the UI can key on it. */
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** A headline amount, shown with <Money>. */
  valueCents?: number;
  /** Where to look at the underlying transactions. */
  link?: string;
}

export interface InsightsPayload {
  month: string;
  generatedAt: number;
  insights: Insight[];
}

export const SEVERITY_ORDER: Record<InsightSeverity, number> = { warn: 0, good: 1, info: 2 };

/** Most important first: warnings, then good news, then notes. Keeps generator order within a severity. */
export function sortInsights(insights: Insight[]): Insight[] {
  return insights
    .map((insight, i) => ({ insight, i }))
    .sort((a, b) => SEVERITY_ORDER[a.insight.severity] - SEVERITY_ORDER[b.insight.severity] || a.i - b.i)
    .map((x) => x.insight);
}
