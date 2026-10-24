import { eq } from "drizzle-orm";
import { paletteColor } from "./palette";
import type { Db } from "./open";
import { categories, settings } from "./schema";

const SEEDED_KEY = "categories_seeded";

export const DEFAULT_CATEGORIES: ReadonlyArray<{
  name: string;
  groupName: string | null;
  icon: string;
  isIncome?: boolean;
}> = [
  { name: "Groceries", groupName: "Food", icon: "shopping-basket" },
  { name: "Dining", groupName: "Food", icon: "utensils" },
  { name: "Transport", groupName: "Living", icon: "car" },
  { name: "Shopping", groupName: "Lifestyle", icon: "shopping-bag" },
  { name: "Bills & Utilities", groupName: "Living", icon: "receipt" },
  { name: "Rent/Mortgage", groupName: "Living", icon: "house" },
  { name: "Subscriptions", groupName: "Lifestyle", icon: "repeat" },
  { name: "Health", groupName: "Living", icon: "heart-pulse" },
  { name: "Travel", groupName: "Lifestyle", icon: "plane" },
  { name: "Entertainment", groupName: "Lifestyle", icon: "clapperboard" },
  { name: "Income", groupName: null, icon: "banknote", isIncome: true },
  { name: "Transfer", groupName: null, icon: "arrow-left-right" },
  { name: "Fees", groupName: null, icon: "landmark" },
  { name: "Gifts", groupName: "Lifestyle", icon: "gift" },
  { name: "Other", groupName: null, icon: "ellipsis" },
];

/**
 * Seeds the default categories exactly once. A marker row in `settings` stops
 * them coming back after the user deletes them all.
 */
export function seedDefaultCategories(db: Db): boolean {
  return db.transaction((tx) => {
    const marker = tx.select().from(settings).where(eq(settings.key, SEEDED_KEY)).get();
    if (marker) return false;
    DEFAULT_CATEGORIES.forEach((c, i) => {
      tx.insert(categories)
        .values({
          name: c.name,
          groupName: c.groupName,
          icon: c.icon,
          color: paletteColor(i),
          isIncome: c.isIncome ?? false,
          sortOrder: i,
        })
        .run();
    });
    tx.insert(settings).values({ key: SEEDED_KEY, value: "1" }).run();
    return true;
  });
}
