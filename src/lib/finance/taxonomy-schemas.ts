import { z } from "zod";
import { CATEGORY_ICON_NAMES } from "./category-icons";

// Client-safe validation shared by the admin APIs and the settings forms.

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #6366F1");

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  groupName: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => (v ? v : null)),
  color: hexColor,
  icon: z
    .enum(CATEGORY_ICON_NAMES)
    .nullish()
    .transform((v) => v ?? null),
  isIncome: z.boolean().default(false),
});

export const categoryPatchSchema = z
  .object({
    name: categoryInputSchema.shape.name,
    groupName: categoryInputSchema.shape.groupName,
    color: hexColor,
    icon: z.enum(CATEGORY_ICON_NAMES).nullable(),
    isIncome: z.boolean(),
    isArchived: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export const tagPatchSchema = z
  .object({ name: z.string().trim().min(1, "Enter a name").max(40), color: hexColor })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export type CategoryInput = z.input<typeof categoryInputSchema>;
export type CategoryPatch = z.infer<typeof categoryPatchSchema>;
export type TagPatch = z.infer<typeof tagPatchSchema>;

export interface CategoryAdminRow {
  id: number;
  name: string;
  groupName: string | null;
  color: string;
  icon: string | null;
  isIncome: boolean;
  sortOrder: number;
  isArchived: boolean;
  txnCount: number;
}

export interface TagAdminRow {
  id: number;
  name: string;
  color: string;
  txnCount: number;
}
