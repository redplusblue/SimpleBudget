import { sql } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { categories, tags } from "@/db/schema";
import { paletteColor } from "@/db/palette";

export interface CategoryOption {
  id: number;
  name: string;
  groupName: string | null;
  color: string;
  icon: string | null;
  isIncome: boolean;
  /** Archived categories keep their transactions but are hidden from pickers. */
  isArchived: boolean;
}

/** Every category (archived ones flagged) so rows can always show the category they were filed under. */
export function listCategories(db: DbLike): CategoryOption[] {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      groupName: categories.groupName,
      color: categories.color,
      icon: categories.icon,
      isIncome: categories.isIncome,
      isArchived: categories.isArchived,
    })
    .from(categories)
    .orderBy(categories.sortOrder, categories.name)
    .all();
}

export const listTags = (db: DbLike) => db.select().from(tags).orderBy(tags.name).all();

export const MAX_TAG_LENGTH = 40;

/** Finds a tag by name (case-insensitive) or creates it with the next palette color. */
export function findOrCreateTag(db: DbLike, rawName: string): typeof tags.$inferSelect {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_TAG_LENGTH) throw new Error(`Tag names must be 1-${MAX_TAG_LENGTH} characters`);
  const existing = db
    .select()
    .from(tags)
    .where(sql`lower(${tags.name}) = ${name.toLowerCase()}`)
    .get();
  if (existing) return existing;
  const count =
    db
      .select({ n: sql<number>`count(*)` })
      .from(tags)
      .get()?.n ?? 0;
  return db
    .insert(tags)
    .values({ name, color: paletteColor(count) })
    .returning()
    .get();
}
