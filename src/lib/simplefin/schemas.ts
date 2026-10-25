import { z } from "zod";

// SimpleFIN servers add fields over time, so every object is loose (unknown keys allowed).

const idLike = z.union([z.string(), z.number()]).transform(String);
const decimalLike = z.union([z.string(), z.number()]).transform(String);

export const transactionSchema = z.looseObject({
  id: idLike,
  posted: z.number(),
  amount: decimalLike,
  description: z.string().default(""),
  payee: z.string().nullish(),
  memo: z.string().nullish(),
  transacted_at: z.number().nullish(),
  pending: z.boolean().nullish(),
  extra: z.unknown().optional(),
});

export const holdingSchema = z.looseObject({
  id: idLike,
  currency: z.string().nullish(),
  cost_basis: decimalLike.nullish(),
  description: z.string().nullish(),
  market_value: decimalLike,
  shares: decimalLike.nullish(),
  symbol: z.string().nullish(),
});

export const accountSchema = z.looseObject({
  org: z
    .looseObject({
      domain: z.string().nullish(),
      name: z.string().nullish(),
      "sfin-url": z.string().nullish(),
      url: z.string().nullish(),
      id: z.string().nullish(),
    })
    .default({}),
  id: idLike,
  name: z.string(),
  currency: z.string().default("USD"),
  balance: decimalLike,
  "available-balance": decimalLike.nullish(),
  "balance-date": z.number().nullish(),
  transactions: z.array(transactionSchema).optional(),
  holdings: z.array(z.unknown()).optional(),
  extra: z.unknown().optional(),
});

export const accountSetSchema = z.looseObject({
  errors: z.array(z.string()).default([]),
  accounts: z.array(accountSchema).default([]),
});

export type SfHolding = z.infer<typeof holdingSchema>;
export type SfTransaction = z.infer<typeof transactionSchema>;
export type SfAccount = z.infer<typeof accountSchema>;
export type SfAccountSet = z.infer<typeof accountSetSchema>;
