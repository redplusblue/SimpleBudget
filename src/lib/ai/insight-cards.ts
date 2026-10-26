import "server-only";
import { desc, eq, isNull, max } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiInsights } from "@/db/schema";
import { currentMonth } from "@/lib/finance/dates";
import { buildAiContext } from "@/lib/llm/context";
import { BASE_SYSTEM } from "@/lib/llm/narrative";
import type { LlmClient } from "@/lib/llm/types";
import { collectFacts, factsForLens, factsForModel } from "./facts";
import type { InsightCardView } from "./insight-types";
import type { LensId } from "./lenses";
import { memoryPromptBlock } from "./memory";

// The model only picks and phrases facts the server computed. Links come from the cited facts, never from output.

export const CARD_TITLE_MAX = 80;
export const CARD_BODY_MAX = 300;
export const DEFAULT_CARD_COUNT = 4;

/** Stable between requests: counts and names go in the user message so providers can cache this prefix. */
export const CARD_SYSTEM = `${BASE_SYSTEM}

You write short insight cards for the owner of a budgeting app. From the facts you are given, choose the most useful ones (warnings first, then good news, then notable changes). Each card has a title under ${CARD_TITLE_MAX} characters and a body under ${CARD_BODY_MAX} characters, friendly and direct, with the exact figures from the fact. Never invent numbers or facts.
Reply with JSON only: [{"facts": ["<fact id>", ...], "severity": "info"|"good"|"warn", "title": "...", "body": "..."}]`;

export interface CardEnv {
  db: DbLike;
  llm: LlmClient;
  model: string;
  runId?: () => number | null;
  now: number;
  timeZone: string;
  includeBalances: boolean;
  userName?: string;
}

interface ParsedCard {
  facts: string[];
  severity: "info" | "good" | "warn";
  title: string;
  body: string;
}

const clamp = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function parseCards(text: string, knownIds: Set<string>, count: number): ParsedCard[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  let raw: unknown;
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return [];
  const out: ParsedCard[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const facts = Array.isArray(item?.facts)
      ? [...new Set(item.facts.filter((f): f is string => typeof f === "string" && knownIds.has(f)))]
      : [];
    if (facts.length === 0 || typeof item.title !== "string" || typeof item.body !== "string") continue;
    const title = item.title.trim();
    const body = item.body.trim();
    if (!title || !body) continue;
    const severity = item.severity === "good" || item.severity === "warn" ? item.severity : "info";
    out.push({ facts, severity, title: clamp(title, CARD_TITLE_MAX), body: clamp(body, CARD_BODY_MAX) });
    if (out.length >= count) break;
  }
  return out;
}

const toView = (r: typeof aiInsights.$inferSelect): InsightCardView => ({
  id: r.id,
  batch: r.batch,
  lens: r.lens,
  model: r.model,
  severity: r.severity,
  title: r.title,
  body: r.body,
  link: r.link,
  pinned: r.pinned,
  createdAt: r.createdAt,
});

/** Generates and stores a batch of cards. No facts means no model call and an empty result. */
export async function generateInsightCards(
  env: CardEnv,
  opts: { lens: LensId | "all"; count?: number },
): Promise<InsightCardView[]> {
  const { db } = env;
  const count = Math.min(Math.max(opts.count ?? DEFAULT_CARD_COUNT, 1), 6);
  const facts = factsForLens(
    collectFacts(db, { now: env.now, timeZone: env.timeZone, includeBalances: env.includeBalances }),
    opts.lens,
  );
  const modelFacts = factsForModel(facts, env.includeBalances);
  if (modelFacts.length === 0) return [];

  const month = currentMonth(env.now, env.timeZone);
  const context = buildAiContext(db, {
    now: env.now,
    timeZone: env.timeZone,
    month,
    includeBalances: env.includeBalances,
  });
  const memories = memoryPromptBlock(db);
  const greeting = env.userName?.trim()
    ? `Address the owner as ${env.userName.trim()} in at most one card, e.g. "Hey ${env.userName.trim()}, ...".`
    : "Do not use the owner's name.";
  const text = await env.llm.generate({
    system: CARD_SYSTEM,
    user: `${memories ? `${memories}\n\n` : ""}Write up to ${count} cards. ${greeting}\n\nFacts:\n${JSON.stringify(modelFacts)}\n\nSummary of this month:\n${JSON.stringify(context)}`,
    maxTokens: 900,
  });

  const known = new Set(modelFacts.map((f) => f.id));
  const cards = parseCards(text, known, count);
  if (cards.length === 0) return [];
  const byId = new Map(facts.map((f) => [f.id, f]));
  const aiRunId = env.runId?.() ?? null;

  return db.transaction((tx) => {
    const batch =
      (tx
        .select({ m: max(aiInsights.batch) })
        .from(aiInsights)
        .get()?.m ?? 0) + 1;
    return cards.map((c) =>
      toView(
        tx
          .insert(aiInsights)
          .values({
            batch,
            lens: opts.lens,
            model: env.model,
            aiRunId,
            severity: c.severity,
            title: c.title,
            body: c.body,
            factIdsJson: JSON.stringify(c.facts),
            link: c.facts.map((id) => byId.get(id)?.link).find((l) => !!l) ?? null,
            createdAt: env.now,
          })
          .returning()
          .get(),
      ),
    );
  });
}

/** Non-dismissed cards, pinned first, then newest batches first. */
export function listInsightCards(db: DbLike, limit = 30): InsightCardView[] {
  return db
    .select()
    .from(aiInsights)
    .where(isNull(aiInsights.dismissedAt))
    .orderBy(desc(aiInsights.pinned), desc(aiInsights.batch), aiInsights.id)
    .limit(Math.min(limit, 100))
    .all()
    .map(toView);
}

export function updateInsightCard(
  db: DbLike,
  id: number,
  patch: { pinned?: boolean; dismissed?: boolean },
  now: number,
): InsightCardView | null {
  const set: Partial<typeof aiInsights.$inferInsert> = {};
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  if (patch.dismissed !== undefined) set.dismissedAt = patch.dismissed ? now : null;
  if (Object.keys(set).length === 0) return null;
  const row = db.update(aiInsights).set(set).where(eq(aiInsights.id, id)).returning().get();
  return row ? toView(row) : null;
}
