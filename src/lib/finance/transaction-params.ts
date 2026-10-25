import { z } from "zod";
import { MoneyParseError, parseCents, centsToDecimalString } from "./cents";
import { isDateString } from "./dates";
import type { TransactionFilters } from "./transaction-types";

// Client-safe: used by the API to validate query strings and by the register to build them.

const dollars = z.string().transform((s, ctx) => {
  try {
    return Math.abs(parseCents(s.trim().replace(/^\$/, "")));
  } catch (e) {
    if (e instanceof MoneyParseError) ctx.addIssue({ code: "custom", message: "Invalid amount" });
    return z.NEVER;
  }
});

const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);

export const filterQuerySchema = z.object({
  account: z.preprocess(emptyToUndef, z.string().min(1).max(200).optional()),
  q: z.preprocess(emptyToUndef, z.string().trim().max(200).optional()),
  from: z.preprocess(emptyToUndef, z.string().refine(isDateString, "Invalid date").optional()),
  to: z.preprocess(emptyToUndef, z.string().refine(isDateString, "Invalid date").optional()),
  category: z.preprocess(emptyToUndef, z.union([z.literal("none"), z.coerce.number().int().positive()]).optional()),
  tag: z.preprocess(emptyToUndef, z.coerce.number().int().positive().optional()),
  min: z.preprocess(emptyToUndef, dollars.optional()),
  max: z.preprocess(emptyToUndef, dollars.optional()),
  type: z.preprocess(emptyToUndef, z.enum(["expense", "income", "transfer"]).optional()),
  status: z.preprocess(emptyToUndef, z.enum(["pending", "unreviewed", "reviewed"]).optional()),
  merchant: z.preprocess(
    emptyToUndef,
    z
      .string()
      .regex(/^[a-z0-9]{1,100}$/, "Invalid merchant")
      .optional(),
  ),
  mname: z.preprocess(emptyToUndef, z.string().trim().max(120).optional()),
});

export const pagingQuerySchema = z.object({
  cursor: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  limit: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(200).optional()),
});

type Params = URLSearchParams | Record<string, string | undefined>;

const toRecord = (p: Params): Record<string, string> =>
  p instanceof URLSearchParams
    ? Object.fromEntries(p.entries())
    : (Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Record<string, string>);

/** Strict parse for the API: bad values produce an error. */
export function parseFilterParams(params: Params) {
  const parsed = filterQuerySchema.safeParse(toRecord(params));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid filters" };
  const v = parsed.data;
  const filters: TransactionFilters = {
    accountId: v.account,
    q: v.q || undefined,
    from: v.from,
    to: v.to,
    categoryId: v.category,
    tagId: v.tag,
    minAmountCents: v.min,
    maxAmountCents: v.max,
    type: v.type,
    status: v.status,
    merchant: v.merchant,
    merchantName: v.merchant ? v.mname : undefined,
  };
  return { ok: true as const, filters };
}

/** Lenient parse for the URL bar: anything invalid is simply dropped. */
export function filtersFromSearchParams(params: Params): TransactionFilters {
  const record = toRecord(params);
  const out: Record<string, string> = {};
  for (const key of Object.keys(filterQuerySchema.shape)) {
    const one = filterQuerySchema.shape[key as keyof typeof filterQuerySchema.shape].safeParse(record[key]);
    if (one.success && one.data !== undefined && record[key] !== undefined) out[key] = record[key];
  }
  const res = parseFilterParams(out);
  return res.ok ? res.filters : {};
}

/** Serializes filters to query-string pairs (empty values omitted). */
export function filtersToSearchParams(f: TransactionFilters): URLSearchParams {
  const sp = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => v !== undefined && v !== "" && sp.set(k, String(v));
  set("account", f.accountId);
  set("q", f.q);
  set("from", f.from);
  set("to", f.to);
  set("category", f.categoryId);
  set("tag", f.tagId);
  set("min", f.minAmountCents !== undefined ? centsToDecimalString(f.minAmountCents) : undefined);
  set("max", f.maxAmountCents !== undefined ? centsToDecimalString(f.maxAmountCents) : undefined);
  set("type", f.type);
  set("status", f.status);
  set("merchant", f.merchant);
  if (f.merchant) set("mname", f.merchantName);
  return sp;
}

export function countActiveFilters(f: TransactionFilters, ignoreAccount = true): number {
  const { accountId, merchantName: _label, ...rest } = f;
  void _label;
  const entries = Object.entries(ignoreAccount ? rest : { accountId, ...rest });
  // from/to count as one "date" filter and min/max as one "amount" filter.
  const keys = new Set(
    entries
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k]) =>
        k === "from" || k === "to" ? "date" : k === "minAmountCents" || k === "maxAmountCents" ? "amount" : k,
      ),
  );
  return keys.size;
}
