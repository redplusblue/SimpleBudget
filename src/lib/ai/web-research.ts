import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { insightsCache } from "@/db/schema";
import { currentMonth } from "@/lib/finance/dates";
import { logger } from "@/lib/logger";
import { getLlmFor, type FeatureLlm } from "@/lib/llm";
import type { AiConfig } from "@/lib/llm/config";
import type { AiProfile } from "@/lib/llm/models";
import { assertWithinBudget, trackRuns } from "@/lib/llm/runs";
import type { Citation } from "@/lib/llm/types";
import type { Fact } from "./facts";
import type { LensId } from "./lenses";

// Web research, in two steps so personal data never reaches a search engine: this module only ever asks a FIXED,
// GENERIC question (a template plus the optional generic profile). The results come back as facts that the normal
// insight/chat request then uses alongside the owner's aggregated numbers, in a request that makes no web call.

export const CACHE_DAYS = 30;
export const MAX_RESULTS = 5;

export const BENCHMARK_IDS = [
  "savings-rate",
  "emergency-fund",
  "retirement-balance",
  "household-spending",
  "credit-utilization",
] as const;
export type BenchmarkId = (typeof BENCHMARK_IDS)[number];

interface Topic {
  lens: LensId;
  label: string;
  question: (p: AiProfile) => string;
}

export const BENCHMARK_TOPICS: Record<BenchmarkId, Topic> = {
  "savings-rate": {
    lens: "cashflow",
    label: "Average personal savings rate",
    question: (p) => `the average personal savings rate in ${p.country}`,
  },
  "emergency-fund": {
    lens: "cashflow",
    label: "Recommended emergency fund",
    question: (p) => `the emergency fund size (in months of expenses) financial planners recommend in ${p.country}`,
  },
  "retirement-balance": {
    lens: "goals",
    label: "Median retirement balance",
    question: (p) =>
      p.ageRange
        ? `the median retirement account balance for people aged ${p.ageRange} in ${p.country}`
        : `the median retirement account balance by age in ${p.country}`,
  },
  "household-spending": {
    lens: "spending",
    label: "Average household spending by category",
    question: (p) =>
      `average monthly household spending by category${p.householdSize ? ` for a household of ${p.householdSize}` : ""} in ${p.country} (for the US, the BLS Consumer Expenditure Survey)`,
  },
  "credit-utilization": {
    lens: "accounts",
    label: "Average credit utilization",
    question: (p) => `the average credit utilization ratio of consumers in ${p.country}`,
  },
};

export interface Benchmark {
  id: BenchmarkId;
  label: string;
  value: string;
  year?: number;
  source: string;
  /** Where the provider says it found it. Links only come from these, never from the model's text. */
  sources: Citation[];
}

export function topicsForLens(lens: LensId | "all"): BenchmarkId[] {
  return BENCHMARK_IDS.filter((id) => lens === "all" || lens === "general" || BENCHMARK_TOPICS[id].lens === lens);
}

export const RESEARCH_SYSTEM =
  "You look up published public statistics. Use reputable sources such as government statistics agencies and major institutions. Reply with JSON only.";

/** The whole research request: a template and the generic profile, nothing else. */
export function researchPrompt(ids: BenchmarkId[], profile: AiProfile): string {
  const topics = ids.map((id, i) => `${i + 1}. [${id}] ${BENCHMARK_TOPICS[id].question(profile)}`).join("\n");
  return `Find the most recent published statistics for:\n${topics}\n\nReply with JSON only: [{"id": "<the id in brackets>", "value": "<the figure, with units>", "year": <year of the data>, "source": "<publisher>"}]. Omit a topic if you cannot find a reliable figure.`;
}

const resultSchema = z.object({
  id: z.enum(BENCHMARK_IDS),
  value: z.string().trim().min(1).max(200),
  year: z.number().int().min(1990).max(2100).optional(),
  source: z.string().trim().min(1).max(100),
});

export function parseResearch(text: string, wanted: BenchmarkId[]): z.infer<typeof resultSchema>[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let raw: unknown;
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const r = resultSchema.safeParse(item);
    if (!r.success || !wanted.includes(r.data.id) || seen.has(r.data.id)) return [];
    seen.add(r.data.id);
    return [r.data];
  });
}

/** https links only, de-duplicated, capped. */
export function safeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    let url: URL;
    try {
      url = new URL(c.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({ url: url.href, ...(c.title ? { title: c.title.slice(0, 200) } : {}) });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

const signature = (p: AiProfile) => [p.country, p.ageRange ?? "", p.householdSize ?? ""].join("|").toLowerCase();
const kindOf = (id: BenchmarkId, p: AiProfile) => `web:${id}:${signature(p)}`;

function readCache(db: DbLike, id: BenchmarkId, p: AiProfile, now: number): Benchmark | null {
  const row = db
    .select()
    .from(insightsCache)
    .where(eq(insightsCache.kind, kindOf(id, p)))
    .orderBy(desc(insightsCache.createdAt), desc(insightsCache.id))
    .get();
  if (!row || now - row.createdAt > CACHE_DAYS * 86_400) return null;
  try {
    const b = JSON.parse(row.payloadJson) as Benchmark;
    return typeof b.value === "string" && typeof b.source === "string" ? b : null;
  } catch {
    return null;
  }
}

function writeCache(db: DbLike, b: Benchmark, p: AiProfile, now: number, timeZone: string) {
  const kind = kindOf(b.id, p);
  db.transaction((tx) => {
    tx.delete(insightsCache)
      .where(and(eq(insightsCache.kind, kind)))
      .run();
    tx.insert(insightsCache)
      .values({ month: currentMonth(now, timeZone), kind, payloadJson: JSON.stringify(b), createdAt: now })
      .run();
  });
}

export interface WebEnv {
  db: DbLike;
  cfg: Pick<AiConfig, "webSearch" | "profile">;
  now: number;
  timeZone: string;
  /** Injected in tests. */
  getLlm?: (db: DbLike) => FeatureLlm | null;
}

/**
 * Public benchmarks for a lens. Does nothing (and makes no web request) unless web research is switched on. Cached
 * results are used first (30 days); the rest are fetched in ONE generic research call that respects the monthly
 * budget. Never throws: benchmarks are optional, so any failure just means fewer of them.
 */
export async function getBenchmarks(env: WebEnv, lens: LensId | "all"): Promise<Benchmark[]> {
  if (!env.cfg.webSearch) return [];
  const { db, now } = env;
  const profile = env.cfg.profile;
  const wanted = topicsForLens(lens);
  const found = new Map<BenchmarkId, Benchmark>();
  for (const id of wanted) {
    const hit = readCache(db, id, profile, now);
    if (hit) found.set(id, hit);
  }
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) {
    try {
      assertWithinBudget(db, now, env.timeZone);
      const picked = (env.getLlm ?? ((d) => getLlmFor(d, "web")))(db);
      if (picked) {
        const llm = trackRuns(db, picked.llm, {
          feature: "web",
          model: picked.model,
          trigger: "manual",
          subject: `benchmarks:${lens}`,
          entry: picked.entry,
        });
        const citations: Citation[] = [];
        const text = await llm.generate({
          system: RESEARCH_SYSTEM,
          user: researchPrompt(missing, profile),
          extraBody: { plugins: [{ id: "web", max_results: MAX_RESULTS }] },
          onAnnotations: (c) => citations.push(...c),
          maxTokens: 800,
        });
        const sources = safeCitations(citations);
        for (const r of parseResearch(text, missing)) {
          const b: Benchmark = {
            id: r.id,
            label: BENCHMARK_TOPICS[r.id].label,
            value: r.value,
            ...(r.year ? { year: r.year } : {}),
            source: r.source,
            sources,
          };
          writeCache(db, b, profile, now, env.timeZone);
          found.set(r.id, b);
        }
      }
    } catch (err) {
      logger.warn({ err }, "web research failed");
    }
  }
  return wanted.flatMap((id) => found.get(id) ?? []);
}

/** Benchmarks as facts for the normal insight or chat request. They make no web request of their own. */
export function benchmarkFacts(benchmarks: Benchmark[]): Fact[] {
  return benchmarks.map((b) => ({
    id: `benchmark:${b.id}`,
    lenses: [BENCHMARK_TOPICS[b.id].lens],
    severity: "info" as const,
    title: `Public data: ${b.label}`,
    detail: `${b.value} (${b.source}${b.year ? `, ${b.year}` : ""}).`,
    sensitive: false,
    sources: b.sources,
  }));
}

/** Plain text (no links) naming where public data came from, appended to a chat answer that was given benchmarks. */
export function sourcesNote(benchmarks: Benchmark[]): string {
  if (benchmarks.length === 0) return "";
  const cited = safeCitations(benchmarks.flatMap((b) => b.sources)).map((c) => {
    const host = new URL(c.url).hostname.replace(/^www\./, "");
    return c.title ? `${c.title} (${host})` : host;
  });
  const publishers = [...new Set(benchmarks.map((b) => b.source))];
  return `\n\nPublic data from ${publishers.join(", ")}.${cited.length ? ` Sources: ${cited.join("; ")}.` : ""}`;
}

/** The benchmark lines added to a chat prompt's data section. */
export function benchmarkPromptBlock(benchmarks: Benchmark[]): string {
  if (benchmarks.length === 0) return "";
  const lines = benchmarks.map((b) => `- ${b.label}: ${b.value} (${b.source}${b.year ? `, ${b.year}` : ""})`);
  return `\nPublic data looked up for this question (generic statistics, not about the owner; name the source when you use it):\n${lines.join("\n")}`;
}
