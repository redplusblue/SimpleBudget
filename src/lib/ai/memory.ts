import "server-only";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { aiMemories } from "@/db/schema";
import { logger } from "@/lib/logger";

export const MAX_MEMORIES = 50;
export const MEMORY_MIN_CHARS = 3;
export const MEMORY_MAX_CHARS = 300;
/** The most memory text that goes into one prompt. */
export const MEMORY_PROMPT_CHARS = 2_000;

export class MemoryError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export const memoryText = z
  .string()
  .trim()
  .min(MEMORY_MIN_CHARS, "Write a little more")
  .max(MEMORY_MAX_CHARS, `Keep it under ${MEMORY_MAX_CHARS} characters`);

export type Memory = typeof aiMemories.$inferSelect;

export function listMemories(db: DbLike): Memory[] {
  return db.select().from(aiMemories).orderBy(asc(aiMemories.createdAt), asc(aiMemories.id)).all();
}

export function addMemory(db: DbLike, text: string, source: Memory["source"], now = Math.floor(Date.now() / 1000)) {
  const parsed = memoryText.safeParse(text);
  if (!parsed.success) throw new MemoryError("invalid", parsed.error.issues[0]?.message ?? "Invalid memory");
  if ((db.select({ n: count() }).from(aiMemories).get()?.n ?? 0) >= MAX_MEMORIES)
    throw new MemoryError("invalid", `You can keep up to ${MAX_MEMORIES} memories. Delete one first.`);
  return db.insert(aiMemories).values({ text: parsed.data, source, createdAt: now }).returning().get();
}

export function updateMemory(db: DbLike, id: number, patch: { text?: string; enabled?: boolean }): Memory {
  const set: Partial<typeof aiMemories.$inferInsert> = {};
  if (patch.text !== undefined) {
    const parsed = memoryText.safeParse(patch.text);
    if (!parsed.success) throw new MemoryError("invalid", parsed.error.issues[0]?.message ?? "Invalid memory");
    set.text = parsed.data;
  }
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (Object.keys(set).length === 0) throw new MemoryError("invalid", "Nothing to change");
  const row = db.update(aiMemories).set(set).where(eq(aiMemories.id, id)).returning().get();
  if (!row) throw new MemoryError("not_found", "Memory not found");
  return row;
}

export function deleteMemory(db: DbLike, id: number): void {
  if (db.delete(aiMemories).where(eq(aiMemories.id, id)).returning({ id: aiMemories.id }).all().length === 0)
    throw new MemoryError("not_found", "Memory not found");
}

/** Enabled memories, oldest first, as `- text` lines; the newest are dropped beyond the character cap. */
export function memoryPromptBlock(db: DbLike): string {
  const lines: string[] = [];
  let used = 0;
  const enabled = listMemories(db).filter((m) => m.enabled);
  for (const m of enabled) {
    const line = `- ${m.text}`;
    if (used + line.length + 1 > MEMORY_PROMPT_CHARS) {
      logger.warn({ kept: lines.length, total: enabled.length }, "memories exceed the prompt cap; newest dropped");
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? `What the owner has told you (always true):\n${lines.join("\n")}` : "";
}
