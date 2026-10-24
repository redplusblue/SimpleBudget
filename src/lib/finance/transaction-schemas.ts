import { z } from "zod";

const id = z.number().int().positive();
const text = (max: number) => z.string().max(max).nullable();

export const transactionPatchSchema = z
  .object({
    categoryId: id.nullable(),
    notes: text(2000),
    payeeOverride: text(200),
    isExcluded: z.boolean(),
    isReviewed: z.boolean(),
    isTransfer: z.boolean(),
    tagIds: z.array(id).max(50),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export const bulkPatchSchema = z.object({
  ids: z.array(id).min(1).max(500),
  patch: z
    .object({
      categoryId: id.nullable(),
      isExcluded: z.boolean(),
      isReviewed: z.boolean(),
      addTagIds: z.array(id).max(50),
      removeTagIds: z.array(id).max(50),
    })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, "No fields to update"),
});

export type TransactionPatchInput = z.infer<typeof transactionPatchSchema>;
export type BulkPatchInput = z.infer<typeof bulkPatchSchema>;
