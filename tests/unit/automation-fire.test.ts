import { describe, expect, it } from "vitest";
import { automationRuns } from "@/db/schema";
import { createDestination } from "@/lib/automations/destinations";
import { runAutomationNow, runAutomationsAfterSync, runScheduledAutomation } from "@/lib/automations/fire";
import { createAutomation, getAutomation, listRuns, setAutomationEnabled } from "@/lib/automations/store";
import { rescheduleAutomations, scheduledCount } from "@/lib/automations/scheduler";
import type { AutomationInput } from "@/lib/automations/types";
import { zonedDayStart } from "@/lib/finance/dates";
import { createTarget } from "@/lib/finance/targets";
import type { Notification } from "@/lib/notify/send";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const at = (d: string) => zonedDayStart(d, "UTC") + 12 * 3600;
const NOW = at("2026-10-24");

function setup() {
  const db = freshDb();
  addAccount(db, "A", { displayName: "Everyday" });
  const dest = createDestination(db, { name: "Hook", kind: "webhook", url: "https://hooks.example/x" });
  const sent: Notification[] = [];
  const deps = {
    send: async (_db: unknown, _id: number, n: Notification) => {
      sent.push(n);
      return { ok: true, status: 200 };
    },
  } as never;
  const make = (over: Partial<AutomationInput>) =>
    createAutomation(db, {
      name: "Auto",
      trigger: { type: "target_exceeded" },
      action: { type: "message", text: "hi" },
      destinationId: dest.id,
      ...over,
    });
  const txn = (date: string, dollars: number, description: string, over = {}) =>
    addTxn(db, "A", { posted: at(date), amountCents: Math.round(dollars * 100), description, ...over });
  return { db, sent, deps, make, txn };
}

const bigSpend = {
  type: "transaction" as const,
  match: "all" as const,
  includePending: false,
  conditions: [{ field: "amount" as const, op: "gt" as const, value: 200_00 }],
};

describe("transaction triggers", () => {
  it("run once with everything new that matches, ignoring transfers, excluded and pending rows", async () => {
    const { db, sent, deps, make, txn } = setup();
    make({ trigger: bigSpend, action: { type: "message", text: "{payee} {amount}" }, includeDetails: true });
    const a = txn("2026-10-24", -250, "BIG ONE");
    const b = txn("2026-10-24", -300, "BIG TWO");
    const small = txn("2026-10-24", -20, "SMALL");
    const transfer = txn("2026-10-24", -500, "XFER", { isTransfer: true });
    const hidden = txn("2026-10-24", -500, "HIDDEN", { isExcluded: true });
    const pending = txn("2026-10-24", -500, "PENDING", { pending: true });
    const newIds = [a, b, small, transfer, hidden, pending].map((t) => t.id);
    await runAutomationsAfterSync(db, { newIds }, NOW, "UTC", deps);
    expect(sent.map((n) => n.message).sort()).toEqual(["BIG ONE $250.00", "BIG TWO $300.00"]);
    expect(listRuns(db, 1)).toHaveLength(1);
  });

  it("can include pending rows, doesn't run without a match, and skips disabled automations", async () => {
    const { db, sent, deps, make, txn } = setup();
    const a = make({ trigger: { ...bigSpend, includePending: true } });
    const pending = txn("2026-10-24", -500, "PENDING", { pending: true });
    await runAutomationsAfterSync(db, { newIds: [pending.id] }, NOW, "UTC", deps);
    expect(sent).toHaveLength(1);
    await runAutomationsAfterSync(db, { newIds: [txn("2026-10-24", -1, "TINY").id] }, NOW, "UTC", deps);
    expect(sent).toHaveLength(1);
    setAutomationEnabled(db, a.id, false);
    await runAutomationsAfterSync(db, { newIds: [pending.id] }, NOW, "UTC", deps);
    expect(sent).toHaveLength(1);
  });
});

describe("target and balance triggers", () => {
  it("fire once per category and month", async () => {
    const { db, sent, deps, make, txn } = setup();
    const dining = categoryId(db, "Dining");
    createTarget(db, { kind: "category", subjectId: dining, amountCents: 10_000 });
    make({ action: { type: "message", text: "{category} is over" } });
    await runAutomationsAfterSync(db, { newIds: [] }, NOW, "UTC", deps);
    expect(sent).toHaveLength(0); // nothing spent yet
    txn("2026-10-10", -150, "RESTAURANT", { categoryId: dining });
    await runAutomationsAfterSync(db, { newIds: [] }, NOW, "UTC", deps);
    await runAutomationsAfterSync(db, { newIds: [] }, NOW + 3600, "UTC", deps);
    expect(sent.map((n) => n.message)).toEqual(["Dining is over"]);
    const nextMonth = at("2026-11-02");
    txn("2026-11-01", -150, "RESTAURANT", { categoryId: dining });
    await runAutomationsAfterSync(db, { newIds: [] }, nextMonth, "UTC", deps);
    expect(sent).toHaveLength(2);
    expect(
      db
        .select()
        .from(automationRuns)
        .all()
        .map((r) => r.dedupeKey),
    ).toContain(`target:${dining}:2026-11`);
  });

  it("balance_below fires at most once a day while below, and not above", async () => {
    const { db, sent, deps, make } = setup();
    make({
      trigger: { type: "balance_below", accountId: "A", cents: 100_00 },
      action: { type: "message", text: "{account} is low" },
      includeDetails: true,
    });
    await runAutomationsAfterSync(db, { newIds: [] }, NOW, "UTC", deps); // balance 0 < $100
    await runAutomationsAfterSync(db, { newIds: [] }, NOW + 3600, "UTC", deps); // same day
    expect(sent.map((n) => n.message)).toEqual(["Everyday is low"]);
    await runAutomationsAfterSync(db, { newIds: [] }, NOW + 86_400, "UTC", deps); // next day, still below
    expect(sent).toHaveLength(2);
    addAccount(db, "B", { balanceCents: 500_00 });
    const ok = createAutomation(db, {
      name: "B",
      trigger: { type: "balance_below", accountId: "B", cents: 100_00 },
      action: { type: "message", text: "x" },
      destinationId: 1,
    });
    await runAutomationsAfterSync(db, { newIds: [] }, NOW + 2 * 86_400, "UTC", deps);
    expect(listRuns(db, ok.id)).toEqual([]);
  });
});

describe("scheduled and manual runs", () => {
  it("runs a scheduled automation unless it was disabled", async () => {
    const { db, sent, deps, make } = setup();
    const a = make({
      trigger: { type: "schedule", every: "day", hour: 9, minute: 0 },
      action: { type: "message", text: "hi {today}" },
    });
    await runScheduledAutomation(db, a.id, NOW, "UTC", deps);
    expect(sent).toHaveLength(1);
    expect(listRuns(db, a.id)).toHaveLength(1);
    setAutomationEnabled(db, a.id, false);
    await runScheduledAutomation(db, a.id, NOW + 1, "UTC", deps);
    await runScheduledAutomation(db, 999, NOW, "UTC", deps); // missing: never throws
    expect(listRuns(db, a.id)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("run now uses the newest matching transaction of the last 30 days as the example", async () => {
    const { db, sent, deps, make, txn } = setup();
    const a = make({ trigger: bigSpend, action: { type: "message", text: "{payee} {date}" }, includeDetails: true });
    expect(await runAutomationNow(db, a.id, NOW, "UTC", deps)).toMatchObject({ status: "skipped" });
    expect(listRuns(db, a.id)).toEqual([]); // nothing was recorded or sent
    txn("2026-09-01", -400, "TOO OLD");
    txn("2026-10-02", -400, "OLDER MATCH");
    txn("2026-10-20", -400, "NEWEST MATCH");
    txn("2026-10-22", -5, "NEWER BUT SMALL");
    expect((await runAutomationNow(db, a.id, NOW, "UTC", deps)).status).toBe("sent");
    expect(sent.map((n) => n.message)).toEqual(["NEWEST MATCH 2026-10-20"]);
    expect(getAutomation(db, a.id).lastStatus).toBe("sent");
  });

  it("schedules one timer per enabled schedule automation", () => {
    const { db, make } = setup();
    (globalThis as unknown as { __sbDb?: unknown }).__sbDb = db;
    try {
      const on = make({ trigger: { type: "schedule", every: "week", hour: 9, minute: 0, weekday: 1 } });
      const off = make({ trigger: { type: "schedule", every: "day", hour: 9, minute: 0 }, enabled: false });
      make({}); // not a schedule
      expect(rescheduleAutomations()).toBe(1);
      expect(scheduledCount()).toBe(1);
      setAutomationEnabled(db, off.id, true);
      expect(rescheduleAutomations()).toBe(2);
      setAutomationEnabled(db, on.id, false);
      setAutomationEnabled(db, off.id, false);
      expect(rescheduleAutomations()).toBe(0);
      expect(scheduledCount()).toBe(0);
    } finally {
      delete (globalThis as unknown as { __sbDb?: unknown }).__sbDb;
    }
  });
});
