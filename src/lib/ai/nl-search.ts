import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { categories, tags } from "@/db/schema";
import { isDateString, localDateString } from "@/lib/finance/dates";
import type { TransactionFilters } from "@/lib/finance/transaction-types";
import type { LlmClient } from "@/lib/llm/types";

// Plain-English transaction search: only the question and the NAMES of categories and tags go to the model. It
// answers with filter values; the app validates them and the register shows them as ordinary, editable filters.

export const SEARCH_SYSTEM = `You turn a plain-English question about someone's bank transactions into search filters for a budgeting app.
Reply with JSON only, an object with any of these optional fields:
- "q": text to look for in the payee or notes (a merchant or word, not a sentence)
- "from", "to": inclusive dates as YYYY-MM-DD (work out relative dates like "last spring" from today's date)
- "category": exactly one category name from the list, or "none" for uncategorized
- "tag": exactly one tag name from the list
- "minAmount", "maxAmount": dollars, positive numbers (sizes, whether money went out or in)
- "type": "expense", "income" or "transfer"
Only include fields the question asks for. Never invent category or tag names.`;

const replySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    category: z.string().trim().max(120).optional(),
    tag: z.string().trim().max(120).optional(),
    minAmount: z.number().finite().min(0).max(1_000_000_000).optional(),
    maxAmount: z.number().finite().min(0).max(1_000_000_000).optional(),
    type: z.enum(["expense", "income", "transfer"]).optional(),
  })
  .partial();

export interface SearchResult {
  filters: TransactionFilters;
  /** Parts of the reply that couldn't be used (unknown category or tag, bad dates), for a gentle note. */
  dropped: string[];
}

export function parseReply(text: string): z.infer<typeof replySchema> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = replySchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Names become ids (unknown ones are dropped), dollars become cents, dates are checked. */
export function mapReply(
  reply: z.infer<typeof replySchema>,
  lookup: { categories: Array<{ id: number; name: string }>; tags: Array<{ id: number; name: string }> },
): SearchResult {
  const filters: TransactionFilters = {};
  const dropped: string[] = [];
  const byName = <T extends { name: string }>(list: T[], name: string) =>
    list.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());

  if (reply.q) filters.q = reply.q;
  if (reply.type) filters.type = reply.type;
  if (reply.category) {
    if (/^(none|uncategori[sz]ed)$/i.test(reply.category)) filters.categoryId = "none";
    else {
      const c = byName(lookup.categories, reply.category);
      if (c) filters.categoryId = c.id;
      else dropped.push(`category "${reply.category}"`);
    }
  }
  if (reply.tag) {
    const t = byName(lookup.tags, reply.tag);
    if (t) filters.tagId = t.id;
    else dropped.push(`tag "${reply.tag}"`);
  }
  if (reply.from) {
    if (isDateString(reply.from)) filters.from = reply.from;
    else dropped.push(`start date "${reply.from}"`);
  }
  if (reply.to) {
    if (isDateString(reply.to)) filters.to = reply.to;
    else dropped.push(`end date "${reply.to}"`);
  }
  if (filters.from && filters.to && filters.from > filters.to) [filters.from, filters.to] = [filters.to, filters.from];
  if (reply.minAmount !== undefined) filters.minAmountCents = Math.round(reply.minAmount * 100);
  if (reply.maxAmount !== undefined) filters.maxAmountCents = Math.round(reply.maxAmount * 100);
  if (
    filters.minAmountCents !== undefined &&
    filters.maxAmountCents !== undefined &&
    filters.minAmountCents > filters.maxAmountCents
  )
    [filters.minAmountCents, filters.maxAmountCents] = [filters.maxAmountCents, filters.minAmountCents];
  return { filters, dropped };
}

const cache = new Map<string, SearchResult>();
const CACHE_MAX = 100;
export const clearSearchCache = () => cache.clear();

export interface SearchEnv {
  db: DbLike;
  llm: LlmClient;
  now: number;
  timeZone: string;
}

/** The filters for a question. Identical questions are answered from a small per-day memory, so they aren't paid for twice. */
export async function plainEnglishFilters(env: SearchEnv, text: string): Promise<SearchResult | null> {
  const question = text.trim();
  const cats = env.db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isArchived, false))
    .all();
  const tagList = env.db.select({ id: tags.id, name: tags.name }).from(tags).all();
  const today = localDateString(env.now, env.timeZone);
  const key = [
    today,
    question.toLowerCase(),
    cats.map((c) => c.name).join(","),
    tagList.map((t) => t.name).join(","),
  ].join("\n");
  const hit = cache.get(key);
  if (hit) return hit;

  const answer = await env.llm.generate({
    system: SEARCH_SYSTEM,
    user: `Today is ${today}.\nCategories: ${cats.map((c) => c.name).join(", ") || "(none)"}\nTags: ${tagList.map((t) => t.name).join(", ") || "(none)"}\n\nQuestion: ${question}`,
    maxTokens: 300,
  });
  const reply = parseReply(answer);
  if (!reply) return null;
  const result = mapReply(reply, { categories: cats, tags: tagList });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
