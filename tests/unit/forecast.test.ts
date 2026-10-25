import { describe, expect, it } from "vitest";
import { zonedDayStart } from "@/lib/finance/dates";
import { getForecast } from "@/lib/finance/forecast";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

/** $3,000 in checking; rent on the 1st, Netflix on the 5th, a biweekly paycheck; plus some one-off shopping. */
function dataset() {
  const db = freshDb();
  addAccount(db, "chk", { type: "checking", balanceCents: 300_000 });
  addAccount(db, "card", { type: "credit", balanceCents: -50_000 });
  addAccount(db, "inv", { type: "investment", balanceCents: 9_000_000 });
  const t = (account: string, date: string, cents: number, description: string) =>
    addTxn(db, account, { posted: at(date), amountCents: cents, description });
  for (const d of ["2026-08-01", "2026-09-01", "2026-10-01"]) t("chk", d, -185_000, "LANDLORD RENT");
  for (const d of ["2026-08-05", "2026-09-05", "2026-10-05"]) t("card", d, -1_549, "NETFLIX.COM");
  for (const d of ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"]) t("chk", d, 250_000, "ACME PAYROLL");
  for (let i = 0; i < 9; i++)
    t("card", `2026-${String(8 + Math.floor(i / 3)).padStart(2, "0")}-${10 + (i % 3) * 5}`, -10_000, `SHOP ${i}`);
  return db;
}

describe("getForecast", () => {
  it("projects the balance day by day from recurring bills and income", () => {
    const f = getForecast(dataset(), NOW, TZ);
    expect(f.startCents).toBe(300_000); // only the checking account counts as cash
    expect(f.accountCount).toBe(1);
    expect(f.days).toHaveLength(31);
    expect(f.days[0].date).toBe("2026-10-24");
    expect(f.days.at(-1)!.date).toBe("2026-11-23");
    expect(f.events.map((e) => [e.date, e.name, e.amountCents, e.kind])).toEqual([
      ["2026-10-30", "ACME PAYROLL", 250_000, "income"],
      ["2026-11-01", "LANDLORD RENT", -185_000, "bill"],
      ["2026-11-05", "NETFLIX.COM", -1_549, "bill"],
      ["2026-11-13", "ACME PAYROLL", 250_000, "income"],
    ]);
    const at$ = (date: string) => f.days.find((d) => d.date === date)!.balanceCents;
    expect(at$("2026-10-29")).toBe(300_000);
    expect(at$("2026-10-30")).toBe(550_000);
    expect(at$("2026-11-01")).toBe(365_000);
    expect(at$("2026-11-05")).toBe(363_451);
    expect(f.endCents).toBe(613_451);
    expect(f.lowest).toEqual({ date: "2026-10-24", balanceCents: 300_000 });
    expect(f.goesNegativeOn).toBeNull();
  });

  it("also shows the balance after typical everyday spending", () => {
    const f = getForecast(dataset(), NOW, TZ);
    // 90 days of spending minus the recurring bills, per day: rent x3 + netflix x3 + 9 shops of $100
    const spent = 3 * 185_000 + 3 * 1_549 + 9 * 10_000;
    const recurringInWindow = Math.round(((185_000 + 1_549) * 90) / 30.4375);
    expect(f.typicalDailySpendCents).toBe(Math.round((spent - recurringInWindow) / 90));
    expect(f.typicalDailySpendCents).toBeGreaterThan(0);
    expect(f.days[0].withSpendingCents).toBe(f.days[0].balanceCents); // nothing is spent "today" yet
    expect(f.days[10].withSpendingCents).toBe(f.days[10].balanceCents - 10 * f.typicalDailySpendCents);
    expect(f.endWithSpendingCents).toBe(f.endCents - 30 * f.typicalDailySpendCents);
  });

  it("warns when the balance would go negative", () => {
    const db = dataset();
    db.$client.prepare("UPDATE accounts SET balance_cents = 100000 WHERE id = 'chk'").run();
    const f = getForecast(db, NOW, TZ);
    expect(f.goesNegativeOn).toBeNull(); // payday on the 30th comes before rent
    db.$client.prepare("UPDATE accounts SET balance_cents = -5000 WHERE id = 'chk'").run();
    const g = getForecast(db, NOW, TZ);
    expect(g.goesNegativeOn).toBe("2026-10-24");
    expect(g.lowest.balanceCents).toBe(-5_000);
    // with everyday spending the line dips below zero earlier than the recurring-only one on a thin balance
    db.$client.prepare("UPDATE accounts SET balance_cents = 5000 WHERE id = 'chk'").run();
    const h = getForecast(db, NOW, TZ);
    expect(h.goesNegativeOn).toBeNull();
    expect(h.goesNegativeWithSpendingOn).not.toBeNull();
  });

  it("an overdue bill is expected tomorrow, and a cancelled one is left out", () => {
    const db = freshDb();
    addAccount(db, "chk", { type: "checking", balanceCents: 100_000 });
    const t = (date: string, cents: number, d: string) =>
      addTxn(db, "chk", { posted: at(date), amountCents: cents, description: d });
    for (const d of ["2026-07-20", "2026-08-20", "2026-09-20"]) t(d, -3_000, "GYM"); // next Oct 20: four days late
    for (const d of ["2026-03-01", "2026-04-01", "2026-05-01"]) t(d, -1_000, "OLD MAGAZINE"); // long gone
    const f = getForecast(db, NOW, TZ);
    // it lands tomorrow (Oct 25); a month after that (Nov 25) is past the 30-day horizon
    expect(f.events.map((e) => [e.date, e.name])).toEqual([["2026-10-25", "GYM"]]);
  });

  it("works with no accounts or history", () => {
    const f = getForecast(freshDb(), NOW, TZ);
    expect(f).toMatchObject({
      startCents: 0,
      endCents: 0,
      events: [],
      accountCount: 0,
      typicalDailySpendCents: 0,
      goesNegativeOn: null,
    });
  });

  it("hidden and closed accounts are not counted", () => {
    const db = dataset();
    addAccount(db, "old", { type: "savings", balanceCents: 500_000, isClosed: true });
    addAccount(db, "hid", { type: "checking", balanceCents: 500_000, isHidden: true });
    expect(getForecast(db, NOW, TZ).startCents).toBe(300_000);
  });
});
