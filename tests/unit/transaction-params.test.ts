import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  parseFilterParams,
} from "@/lib/finance/transaction-params";
import { bulkPatchSchema, transactionPatchSchema } from "@/lib/finance/transaction-schemas";

describe("filter params", () => {
  it("parses a full query string into filters (dollars → cents, abs)", () => {
    const res = parseFilterParams(
      new URLSearchParams(
        "account=a1&q=coffee&from=2026-03-01&to=2026-03-31&category=none&tag=4&min=$5&max=100.50&type=expense&status=unreviewed",
      ),
    );
    expect(res).toEqual({
      ok: true,
      filters: {
        accountId: "a1",
        q: "coffee",
        from: "2026-03-01",
        to: "2026-03-31",
        categoryId: "none",
        tagId: 4,
        minAmountCents: 500,
        maxAmountCents: 10050,
        type: "expense",
        status: "unreviewed",
      },
    });
  });

  it("treats empty values as absent and numeric categories as numbers", () => {
    const res = parseFilterParams({ q: "", category: "12", from: "" });
    expect(res).toMatchObject({ ok: true, filters: { categoryId: 12 } });
  });

  it.each(["from=2026-02-30", "type=bogus", "status=x", "min=abc", "tag=-1", "category=0", "category=x"])(
    "rejects %s",
    (qs) => {
      expect(parseFilterParams(new URLSearchParams(qs)).ok).toBe(false);
    },
  );

  it("drops invalid values leniently for the URL bar", () => {
    expect(filtersFromSearchParams(new URLSearchParams("q=ok&type=bogus&from=nope&min=5"))).toEqual({
      accountId: undefined,
      q: "ok",
      from: undefined,
      to: undefined,
      categoryId: undefined,
      tagId: undefined,
      minAmountCents: 500,
      maxAmountCents: undefined,
      type: undefined,
      status: undefined,
    });
  });

  it("round-trips through the query string", () => {
    const f = {
      q: "a b",
      from: "2026-01-01",
      categoryId: "none" as const,
      minAmountCents: 1234,
      type: "income" as const,
    };
    const sp = filtersToSearchParams(f);
    expect(sp.get("min")).toBe("12.34");
    expect(filtersFromSearchParams(sp)).toMatchObject(f);
    expect(filtersToSearchParams({}).toString()).toBe("");
  });

  it("counts date and amount ranges as one filter each and ignores the account", () => {
    expect(
      countActiveFilters({
        accountId: "a",
        from: "2026-01-01",
        to: "2026-01-31",
        minAmountCents: 1,
        maxAmountCents: 2,
        q: "x",
      }),
    ).toBe(3);
    expect(countActiveFilters({})).toBe(0);
  });
});

describe("merchant filter params", () => {
  it("parses the key and its display name, and round-trips", () => {
    const res = parseFilterParams(new URLSearchParams("merchant=traderjoes&mname=Trader%20Joe%27s"));
    expect(res).toMatchObject({ ok: true, filters: { merchant: "traderjoes", merchantName: "Trader Joe's" } });
    const sp = filtersToSearchParams({ merchant: "traderjoes", merchantName: "Trader Joe's" });
    expect(sp.get("merchant")).toBe("traderjoes");
    expect(filtersFromSearchParams(sp)).toMatchObject({ merchant: "traderjoes", merchantName: "Trader Joe's" });
  });
  it("ignores a display name without a merchant and rejects bad keys", () => {
    expect(parseFilterParams(new URLSearchParams("mname=Orphan"))).toMatchObject({
      ok: true,
      filters: { merchant: undefined, merchantName: undefined },
    });
    expect(parseFilterParams(new URLSearchParams("merchant=Has Spaces")).ok).toBe(false);
    expect(parseFilterParams(new URLSearchParams("merchant=a'b")).ok).toBe(false);
    expect(filtersToSearchParams({ merchantName: "x" }).toString()).toBe("");
  });
  it("counts a merchant as one filter (its label isn't a second one)", () => {
    expect(countActiveFilters({ merchant: "traderjoes", merchantName: "Trader Joe's" })).toBe(1);
  });
});

describe("patch schemas", () => {
  it("accepts overlay edits and rejects unknown or empty patches", () => {
    expect(transactionPatchSchema.safeParse({ categoryId: null, notes: "x", tagIds: [1, 2] }).success).toBe(true);
    expect(transactionPatchSchema.safeParse({}).success).toBe(false);
    expect(transactionPatchSchema.safeParse({ amountCents: 5 }).success).toBe(false); // bank fields are read-only
    expect(transactionPatchSchema.safeParse({ description: "x" }).success).toBe(false);
    expect(transactionPatchSchema.safeParse({ categoryId: 0 }).success).toBe(false);
    expect(transactionPatchSchema.safeParse({ notes: "x".repeat(2001) }).success).toBe(false);
  });
  it("validates bulk requests", () => {
    expect(bulkPatchSchema.safeParse({ ids: [1], patch: { isReviewed: true } }).success).toBe(true);
    expect(bulkPatchSchema.safeParse({ ids: [], patch: { isReviewed: true } }).success).toBe(false);
    expect(bulkPatchSchema.safeParse({ ids: [1], patch: {} }).success).toBe(false);
    expect(
      bulkPatchSchema.safeParse({ ids: Array.from({ length: 501 }, (_, i) => i + 1), patch: { isReviewed: true } })
        .success,
    ).toBe(false);
    expect(bulkPatchSchema.safeParse({ ids: [1], patch: { notes: "x" } }).success).toBe(false);
  });
});
