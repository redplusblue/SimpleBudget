import { describe, expect, it } from "vitest";
import { zonedDayStart } from "@/lib/finance/dates";
import { createContext } from "@/lib/insights/data";
import {
  balanceAlerts,
  categoryChanges,
  duplicateCharges,
  incomeEvents,
  largeTransactions,
  newMerchants,
  spendingPace,
  staleManualAccounts,
  subscriptions,
  uncategorizedReminder,
} from "@/lib/insights/generators";
import { getInsights } from "@/lib/insights";
import { sortInsights, type Insight } from "@/lib/insights/types";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

function setup() {
  const db = freshDb();
  addAccount(db, "A");
  const spend = (date: string, dollars: number, description: string, category?: number) =>
    addTxn(db, "A", { posted: at(date), amountCents: -Math.round(dollars * 100), description, categoryId: category });
  const earn = (date: string, dollars: number, description: string) =>
    addTxn(db, "A", { posted: at(date), amountCents: Math.round(dollars * 100), description });
  const ctx = (now = NOW) => createContext(db, now, TZ, new Date(now * 1000).toISOString().slice(0, 7));
  return { db, spend, earn, ctx };
}

describe("categoryChanges", () => {
  function dataset() {
    const s = setup();
    const [dining, groceries, transport] = ["Dining", "Groceries", "Transport"].map((n) => categoryId(s.db, n));
    for (const m of ["2026-07", "2026-08", "2026-09"]) {
      s.spend(`${m}-10`, 100, "RESTAURANT", dining);
      s.spend(`${m}-11`, 300, "SUPERMARKET", groceries);
      s.spend(`${m}-12`, 200, "BUS PASS", transport);
    }
    s.spend("2026-10-05", 200, "RESTAURANT", dining); // 3-month average is $100; by the 24th you'd expect ~$77
    s.spend("2026-10-06", 240, "SUPERMARKET", groceries); // expected ~$232, so it's within bounds
    s.spend("2026-10-07", 20, "BUS PASS", transport); // expected ~$155
    return { ...s, dining, groceries, transport };
  }

  it("flags categories well above or below their average for this point in the month", () => {
    const { ctx, dining, transport } = dataset();
    const out = categoryChanges(ctx());
    expect(out.map((i) => [i.id, i.severity])).toEqual([
      [`category-down:${transport}:2026-10`, "good"],
      [`category-up:${dining}:2026-10`, "warn"],
    ]);
    // Ordered by the size of the change; the page sorts by severity afterwards.
    expect(out[1].title).toBe("Dining spending is up 158%"); // 200 vs 77.42
    expect(out[1].valueCents).toBe(20_000 - 7_742);
    expect(out[0].title).toBe("Transport spending is down 87%"); // 20 vs 154.84
  });

  it("stays quiet for the first week of the month, when partial data would mislead", () => {
    expect(categoryChanges(dataset().ctx(at("2026-10-06")))).toEqual([]);
  });

  it("ignores big percentage swings under $50", () => {
    const { db, spend, ctx } = setup();
    const c = categoryId(db, "Dining");
    for (const m of ["2026-07", "2026-08", "2026-09"]) spend(`${m}-10`, 10, "COFFEE", c);
    spend("2026-10-02", 40, "COFFEE", c);
    expect(categoryChanges(ctx(at("2026-10-31")))).toEqual([]); // +$30 on a $10 average
  });
});

describe("newMerchants", () => {
  function dataset() {
    const s = setup();
    for (let i = 0; i < 20; i++) s.spend(`2026-08-${String(i + 1).padStart(2, "0")}`, 5, "OLD COFFEE");
    s.spend("2026-09-01", 300, "BOOKSTORE"); // first seen long ago
    s.spend("2026-10-20", 300, "BOOKSTORE");
    return s;
  }

  it("flags a merchant first seen recently with a purchase over twice the typical one", () => {
    const s = dataset();
    s.spend("2026-10-20", 120, "FANCY STEAKHOUSE");
    s.spend("2026-10-21", 6, "TINY SHOP");
    const out = newMerchants(s.ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "new-merchant:fancysteakhouse", severity: "info", valueCents: 12_000 });
    expect(out[0].title).toContain("FANCY STEAKHOUSE");
    expect(out[0].link).toContain("merchant=fancysteakhouse");
  });

  it("says nothing when there is too little history to know what's new", () => {
    const s = setup();
    s.spend("2026-10-10", 5, "COFFEE");
    s.spend("2026-10-20", 500, "BIG PURCHASE");
    expect(newMerchants(s.ctx())).toEqual([]);
  });
});

describe("subscriptions", () => {
  it("reports price increases and newly detected recurring charges", () => {
    const { spend, ctx } = setup();
    spend("2026-07-20", 10, "NETFLIX");
    spend("2026-08-20", 10, "NETFLIX");
    spend("2026-09-20", 10, "NETFLIX");
    spend("2026-10-20", 13, "NETFLIX");
    spend("2026-08-22", 8, "HULU");
    spend("2026-09-22", 8, "HULU");
    spend("2026-10-22", 8, "HULU");
    for (const d of ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]) spend(d, 5, "SPOTIFY");
    const out = subscriptions(ctx());
    const byId = Object.fromEntries(out.map((i) => [i.id, i]));
    expect(byId["price-increase:netflix"]).toMatchObject({ severity: "warn", valueCents: 300 });
    expect(byId["price-increase:netflix"].title).toBe("NETFLIX went up 30%");
    expect(byId["new-recurring:hulu"]).toMatchObject({ severity: "info", valueCents: 800 });
    expect(byId["new-recurring:spotify"]).toBeUndefined(); // established, unchanged
    expect(out).toHaveLength(2);
  });
});

describe("largeTransactions", () => {
  it("flags a recent charge far above the category's norm (needs enough history)", () => {
    const { db, spend, ctx } = setup();
    const groceries = categoryId(db, "Groceries");
    const dining = categoryId(db, "Dining");
    for (let i = 0; i < 12; i++)
      spend(`2026-0${3 + (i % 6)}-${String(10 + i)}`, 48 + (i % 5), "SUPERMARKET", groceries);
    for (let i = 0; i < 5; i++) spend(`2026-08-${10 + i}`, 40, "RESTAURANT", dining);
    spend("2026-10-22", 400, "SUPERMARKET", groceries); // way out
    spend("2026-10-23", 55, "SUPERMARKET", groceries); // normal
    spend("2026-10-22", 900, "RESTAURANT", dining); // too little history
    const out = largeTransactions(ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "warn", valueCents: 40_000 });
    expect(out[0].title).toBe("Unusually large Groceries charge");
  });
});

describe("spendingPace", () => {
  function dataset() {
    const s = setup();
    for (const m of ["2026-07", "2026-08", "2026-09"]) s.spend(`${m}-10`, 1000, "RENT");
    return s;
  }

  it("projects month-end spending and compares it with the 3-month average", () => {
    const s = dataset();
    s.spend("2026-10-05", 1000, "RENT");
    const [pace] = spendingPace(s.ctx());
    // $1000 in 24 days of 31 -> $1291.67 against an average of $1000
    expect(pace).toMatchObject({ id: "pace:2026-10", severity: "warn", valueCents: 129_167 });
    expect(pace.body).toContain("29% above");
  });

  it("is good news when well below average and neutral near it", () => {
    const low = dataset();
    low.spend("2026-10-05", 300, "RENT");
    expect(spendingPace(low.ctx())[0].severity).toBe("good"); // projects ~$388
    const near = dataset();
    near.spend("2026-10-05", 780, "RENT"); // ~$1007
    expect(spendingPace(near.ctx())[0].severity).toBe("info");
  });

  it("waits for a few days of data, needs history, and only talks about the current month", () => {
    const s = dataset();
    s.spend("2026-10-02", 100, "RENT");
    expect(spendingPace(s.ctx(at("2026-10-04")))).toEqual([]);
    expect(spendingPace(setup().ctx())).toEqual([]); // no history
    expect(spendingPace(createContext(s.db, NOW, TZ, "2026-09"))).toEqual([]);
  });
});

describe("incomeEvents", () => {
  function payroll() {
    const s = setup();
    s.earn("2026-09-10", 2000, "ACME PAYROLL");
    s.earn("2026-09-24", 2000, "ACME PAYROLL");
    s.earn("2026-10-08", 2000, "ACME PAYROLL");
    return s;
  }

  it("reports a deposit whose amount changed", () => {
    const s = payroll();
    s.earn("2026-10-22", 2200, "ACME PAYROLL");
    const [i] = incomeEvents(s.ctx());
    expect(i).toMatchObject({ severity: "good", valueCents: 20_000 });
    expect(i.title).toBe("ACME PAYROLL deposit increased");
    const lower = payroll();
    lower.earn("2026-10-22", 1500, "ACME PAYROLL");
    expect(incomeEvents(lower.ctx())[0]).toMatchObject({ severity: "warn", valueCents: -50_000 });
  });

  it("announces income that arrived as usual, only when recent", () => {
    const s = payroll();
    s.earn("2026-10-22", 2000, "ACME PAYROLL");
    expect(incomeEvents(s.ctx())[0].title).toBe("Income arrived from ACME PAYROLL");
    expect(incomeEvents(payroll().ctx())).toEqual([]); // latest was Oct 8, over a week ago
  });

  it("ignores small deposits", () => {
    const s = setup();
    s.earn("2026-10-22", 40, "VENMO");
    expect(incomeEvents(s.ctx())).toEqual([]);
  });
});

describe("duplicateCharges", () => {
  it("flags the same merchant and amount within 48 hours", () => {
    const { spend, ctx } = setup();
    spend("2026-10-20", 12.5, "CORNER CAFE");
    spend("2026-10-21", 12.5, "CORNER CAFE");
    spend("2026-10-10", 9, "DINER");
    spend("2026-10-13", 9, "DINER"); // three days apart
    spend("2026-10-20", 7, "BAKERY");
    spend("2026-10-20", 8, "BAKERY"); // different amount
    const out = duplicateCharges(ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "warn", valueCents: 1250 });
    expect(out[0].title).toBe("Possible duplicate charge at CORNER CAFE");
    expect(out[0].body).toContain("2026-10-20 and again on 2026-10-21");
  });

  it("does not pair one transaction twice", () => {
    const { spend, ctx } = setup();
    for (let i = 0; i < 3; i++) spend("2026-10-20", 10, "CAFE");
    expect(duplicateCharges(ctx())).toHaveLength(1);
  });
});

describe("balanceAlerts", () => {
  it("warns about low balances and high credit utilization, but only where thresholds are set", () => {
    const { db, ctx } = setup();
    addAccount(db, "low", { balanceCents: 30_000, lowBalanceCents: 50_000, displayName: "Everyday" });
    addAccount(db, "fine", { balanceCents: 60_000, lowBalanceCents: 50_000 });
    addAccount(db, "nothreshold", { balanceCents: 1 });
    addAccount(db, "hidden", { balanceCents: 1, lowBalanceCents: 50_000, isHidden: true });
    addAccount(db, "card-mid", { type: "credit", balanceCents: -200_000, creditLimitCents: 500_000 }); // 40%
    addAccount(db, "card-high", { type: "credit", balanceCents: -300_000, creditLimitCents: 500_000 }); // 60%
    addAccount(db, "card-low", { type: "credit", balanceCents: -50_000, creditLimitCents: 500_000 }); // 10%
    addAccount(db, "card-nolimit", { type: "credit", balanceCents: -900_000 });
    const out = balanceAlerts(ctx());
    const byId = Object.fromEntries(out.map((i) => [i.id, i]));
    expect(Object.keys(byId).sort()).toEqual(["low-balance:low", "utilization:card-high", "utilization:card-mid"]);
    expect(byId["low-balance:low"]).toMatchObject({
      severity: "warn",
      title: "Everyday is running low",
      valueCents: 30_000,
    });
    expect(byId["utilization:card-mid"]).toMatchObject({ severity: "info", title: "card-mid is at 40% of its limit" });
    expect(byId["utilization:card-high"].severity).toBe("warn");
  });
});

describe("staleManualAccounts", () => {
  it("flags manual accounts untouched for 30+ days, warning from 60", () => {
    const { db, ctx } = setup();
    const created = (date: string) => at(date);
    addAccount(db, "fresh", { isManual: true, createdAt: created("2026-10-10") });
    addAccount(db, "old", { isManual: true, displayName: "Cash jar", createdAt: created("2026-09-04") }); // 50 days
    addAccount(db, "ancient", { isManual: true, createdAt: created("2026-08-01") }); // 84 days
    addAccount(db, "synced", { createdAt: created("2026-01-01") }); // not manual
    addAccount(db, "hidden", { isManual: true, isHidden: true, createdAt: created("2026-01-01") });
    const out = staleManualAccounts(ctx());
    expect(out.map((i) => [i.id, i.severity]).sort()).toEqual([
      ["stale-manual:ancient", "warn"],
      ["stale-manual:old", "info"],
    ]);
    expect(out.find((i) => i.id === "stale-manual:old")).toMatchObject({
      title: "You haven't updated Cash jar in 50 days",
      link: "/accounts/old",
    });
  });

  it("counts a recent transaction as an update", () => {
    const { db, ctx } = setup();
    addAccount(db, "m", { isManual: true, createdAt: at("2026-01-01") });
    expect(staleManualAccounts(ctx())).toHaveLength(1);
    addTxn(db, "m", { posted: at("2026-10-20") });
    expect(staleManualAccounts(ctx())).toHaveLength(0);
  });
});

describe("uncategorizedReminder", () => {
  it("counts recent uncategorized purchases, not transfers or income", () => {
    const { db, spend, earn, ctx } = setup();
    for (let i = 0; i < 4; i++) spend("2026-10-10", 5, `THING ${i}`);
    addTxn(db, "A", { posted: at("2026-10-10"), amountCents: -500, isTransfer: true });
    earn("2026-10-10", 500, "REFUND");
    expect(uncategorizedReminder(ctx())).toEqual([]);
    spend("2026-10-11", 5, "ONE MORE");
    const [i] = uncategorizedReminder(ctx());
    expect(i).toMatchObject({ id: "uncategorized", severity: "info", title: "5 purchases need a category" });
    expect(i.link).toContain("category=none");
  });
});

describe("sorting and getInsights", () => {
  it("orders warnings, then good news, then notes, keeping generator order within a level", () => {
    const mk = (id: string, severity: Insight["severity"]): Insight => ({ id, severity, title: id, body: "" });
    const sorted = sortInsights([
      mk("i1", "info"),
      mk("w1", "warn"),
      mk("g1", "good"),
      mk("w2", "warn"),
      mk("i2", "info"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["w1", "w2", "g1", "i1", "i2"]);
  });

  it("returns an empty list for an empty database and collects everything otherwise", () => {
    expect(getInsights(freshDb(), { now: NOW, timeZone: TZ }).insights).toEqual([]);
    const s = setup();
    addAccount(s.db, "low", { balanceCents: 1, lowBalanceCents: 100 });
    s.spend("2026-10-20", 12.5, "CAFE");
    s.spend("2026-10-20", 12.5, "CAFE");
    const out = getInsights(s.db, { now: NOW, timeZone: TZ });
    expect(out.month).toBe("2026-10");
    expect(out.insights.map((i) => i.id)).toEqual(expect.arrayContaining(["low-balance:low"]));
    expect(out.insights.every((i) => i.severity === "warn")).toBe(true);
  });
});
