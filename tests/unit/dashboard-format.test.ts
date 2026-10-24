import { describe, expect, it } from "vitest";
import { monthLink, percent } from "@/components/dashboard/format";
import { filtersFromSearchParams } from "@/lib/finance/transaction-params";

describe("monthLink", () => {
  it("covers the whole month and parses back into register filters", () => {
    const link = monthLink("2026-02", { type: "expense", category: "7" });
    expect(link.startsWith("/transactions?")).toBe(true);
    const filters = filtersFromSearchParams(new URLSearchParams(link.split("?")[1]));
    expect(filters).toMatchObject({ from: "2026-02-01", to: "2026-02-28", type: "expense", categoryId: 7 });
    expect(monthLink("2028-02")).toContain("to=2028-02-29");
  });
  it("supports the uncategorized filter", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams(monthLink("2026-10", { category: "none" }).split("?")[1]),
    );
    expect(filters.categoryId).toBe("none");
  });
});

describe("percent", () => {
  it("formats absolute ratios", () => {
    expect(percent(0.1234)).toBe("12.3%");
    expect(percent(-0.05, 0)).toBe("5%");
  });
});
