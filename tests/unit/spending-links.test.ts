import { describe, expect, it } from "vitest";
import { incomeHref, monthSpan, spendingHref, transactionsHref } from "@/components/spending/links";
import { filtersFromSearchParams } from "@/lib/finance/transaction-params";

const parse = (href: string) => filtersFromSearchParams(new URLSearchParams(href.split("?")[1] ?? ""));

describe("drill-down links", () => {
  it("monthSpan covers whole months", () => {
    expect(monthSpan("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthSpan("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("spending links open expenses in the range, and parse back into the same filters", () => {
    const href = spendingHref(monthSpan("2026-10"), { categoryId: 7 });
    expect(href.startsWith("/transactions?")).toBe(true);
    expect(parse(href)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", type: "expense", categoryId: 7 });
  });

  it("supports every drill-down target", () => {
    const span = { from: "2026-03-01", to: "2026-03-31" };
    expect(parse(spendingHref(span, { categoryId: "none" })).categoryId).toBe("none");
    expect(parse(spendingHref(span, { tagId: 4 })).tagId).toBe(4);
    expect(parse(spendingHref(span, { accountId: "ACT-1" })).accountId).toBe("ACT-1");
    expect(parse(spendingHref(span, { merchant: "traderjoes", merchantName: "Trader Joe's" }))).toMatchObject({
      merchant: "traderjoes",
      merchantName: "Trader Joe's",
    });
    expect(parse(spendingHref({ from: "2026-03-05", to: "2026-03-05" })).from).toBe("2026-03-05"); // a single day (heatmap)
    expect(parse(incomeHref(span))).toMatchObject({ type: "income", from: "2026-03-01" });
    expect(parse(spendingHref(span, { minAmountCents: 20_000 })).minAmountCents).toBe(20_000);
  });

  it("an empty filter set is the plain register", () => {
    expect(transactionsHref({})).toBe("/transactions");
  });
});

import { calendarWeeks, heatScale, intensity } from "@/components/spending/heatmap-utils";

describe("heatmap helpers", () => {
  it("scales intensity from 0 to 4 relative to the busiest day", () => {
    expect(intensity(0, 1000)).toBe(0);
    expect(intensity(1, 1000)).toBe(1);
    expect(intensity(250, 1000)).toBe(1);
    expect(intensity(251, 1000)).toBe(2);
    expect(intensity(1000, 1000)).toBe(4);
    expect(intensity(5, 0)).toBe(0);
  });

  it("scales against the 90th percentile so one huge day doesn't flatten the rest", () => {
    const day = (cents: number, i: number) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      cents,
      future: false,
    });
    expect(heatScale([...Array(9).fill(1000), 185_000].map(day))).toBe(185_000); // with 10 days, the top one is the 90th percentile
    expect(heatScale([...Array(19).fill(1000), 185_000].map(day))).toBe(1000); // 20 days: one outlier no longer sets the scale
    const many = [...Array(29).fill(1000), 185_000].map(day);
    expect(heatScale(many)).toBe(1000);
    expect(intensity(1000, heatScale(many))).toBe(4); // ordinary days now show as busy rather than pale
    expect(intensity(185_000, heatScale(many))).toBe(4); // the outlier is capped at the darkest shade
    expect(heatScale([])).toBe(0);
    expect(heatScale([day(0, 0)])).toBe(0);
  });

  it("lays days out in Sunday-first weeks with padding", () => {
    const days = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      cents: 0,
      future: false,
    }));
    const weeks = calendarWeeks(days);
    // October 2026 starts on a Thursday: four blank cells, then the 1st.
    expect(weeks[0].map((d) => d?.date.slice(8) ?? null)).toEqual([null, null, null, null, "01", "02", "03"]);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[4].filter(Boolean).map((d) => d!.date.slice(8))).toEqual(["25", "26", "27", "28", "29", "30", "31"]);
    expect(calendarWeeks([])).toEqual([]);
  });
});

import { currentMonthLocal, customPresets, parseRange, rangeQuery } from "@/components/spending/range-state";

describe("range state", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("parses months and custom ranges from the address", () => {
    expect(parseRange(q("month=2026-03"), "2026-10")).toEqual({ kind: "month", month: "2026-03" });
    expect(parseRange(q("from=2026-03-01&to=2026-03-15"), "2026-10")).toEqual({
      kind: "custom",
      from: "2026-03-01",
      to: "2026-03-15",
    });
    expect(parseRange(q(""), "2026-10")).toEqual({ kind: "month", month: "2026-10" });
  });
  it("falls back for anything invalid", () => {
    for (const bad of [
      "month=2026-13",
      "month=nope",
      "from=2026-03-15&to=2026-03-01",
      "from=2026-02-30&to=2026-03-01",
      "from=2026-03-01",
    ]) {
      expect(parseRange(q(bad), "2026-10")).toEqual({ kind: "month", month: "2026-10" });
    }
  });
  it("round-trips through the query string", () => {
    for (const r of [
      { kind: "month", month: "2026-03" },
      { kind: "custom", from: "2026-03-01", to: "2026-03-15" },
    ] as const) {
      expect(parseRange(q(rangeQuery(r)), "x")).toEqual(r);
    }
  });
  it("builds sensible presets", () => {
    const now = new Date(2026, 9, 24);
    expect(currentMonthLocal(now)).toBe("2026-10");
    const p = Object.fromEntries(customPresets(now).map((x) => [x.label, x]));
    expect(p["Last 30 days"]).toEqual({ label: "Last 30 days", from: "2026-09-25", to: "2026-10-24" });
    expect(p["Last month"]).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(p["Year to date"]).toMatchObject({ from: "2026-01-01", to: "2026-10-24" });
    expect(p["Last 12 months"]).toMatchObject({ from: "2025-10-25", to: "2026-10-24" });
  });
});
