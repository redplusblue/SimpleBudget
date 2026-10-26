import { describe, expect, it } from "vitest";
import { createDestination, deleteDestination } from "@/lib/automations/destinations";
import {
  AutomationError,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  setAutomationEnabled,
  updateAutomation,
} from "@/lib/automations/store";
import {
  automationInputSchema,
  MAX_AUTOMATIONS,
  renderTemplate,
  scheduleToCron,
  TEMPLATE_VARIABLES,
  type AutomationInput,
} from "@/lib/automations/types";
import { updateAiConfig } from "@/lib/llm/config";
import { addAccount, freshDb } from "../helpers/db";

function setup() {
  const db = freshDb();
  const dest = createDestination(db, { name: "Server", kind: "discord", url: "https://discord.com/api/webhooks/1/x" });
  const base = (over: Partial<AutomationInput> = {}): AutomationInput => ({
    name: "Weekly",
    trigger: { type: "schedule", every: "week", hour: 9, minute: 0, weekday: 0 },
    action: { type: "message", text: "Hello {today}" },
    destinationId: dest.id,
    ...over,
  });
  return { db, dest, base };
}

describe("scheduleToCron", () => {
  it("builds preset cron expressions only", () => {
    expect(scheduleToCron({ type: "schedule", every: "day", hour: 7, minute: 15 })).toBe("15 7 * * *");
    expect(scheduleToCron({ type: "schedule", every: "week", hour: 9, minute: 0, weekday: 0 })).toBe("0 9 * * 0");
    expect(scheduleToCron({ type: "schedule", every: "month", hour: 18, minute: 45, monthDay: 1 })).toBe("45 18 1 * *");
  });

  it("requires a weekday for weekly and a day 1-28 for monthly, and only quarter-hour minutes", () => {
    const parse = (trigger: object) =>
      automationInputSchema.safeParse({ name: "x", trigger, action: { type: "message", text: "t" }, destinationId: 1 });
    expect(parse({ type: "schedule", every: "week", hour: 9, minute: 0 }).success).toBe(false);
    expect(parse({ type: "schedule", every: "month", hour: 9, minute: 0 }).success).toBe(false);
    expect(parse({ type: "schedule", every: "month", hour: 9, minute: 0, monthDay: 29 }).success).toBe(false);
    expect(parse({ type: "schedule", every: "day", hour: 9, minute: 1 }).success).toBe(false); // no every-minute schedules
    expect(parse({ type: "schedule", every: "day", hour: 24, minute: 0 }).success).toBe(false);
    expect(parse({ type: "schedule", every: "day", hour: 9, minute: 30 }).success).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("fills every allow-listed variable", () => {
    const vars = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, `<${v}>`]));
    for (const v of TEMPLATE_VARIABLES) expect(renderTemplate(`x {${v}} y`, vars)).toBe(`x <${v}> y`);
    expect(renderTemplate("{payee} paid {amount}", { payee: "Acme", amount: "$5.00" })).toBe("Acme paid $5.00");
  });

  it("leaves anything else as literal text", () => {
    const vars = { payee: "Acme" };
    expect(renderTemplate("{constructor} {__proto__} {toString} {unknown}", vars)).toBe(
      "{constructor} {__proto__} {toString} {unknown}",
    );
    expect(renderTemplate("{{payee}}", vars)).toBe("{{payee}}");
    expect(renderTemplate("{amount} unset", vars)).toBe("{amount} unset"); // no value for it here
    expect(renderTemplate("{ payee } {PAYEE}", vars)).toBe("{ payee } {PAYEE}");
  });
});

describe("automation store", () => {
  it("creates, lists, updates, disables and deletes", () => {
    const { db, base } = setup();
    const a = createAutomation(db, base(), 100);
    expect(a).toMatchObject({ name: "Weekly", enabled: true, model: null, includeDetails: false, createdAt: 100 });
    expect(listAutomations(db)).toHaveLength(1);
    expect(updateAutomation(db, a.id, base({ name: "Renamed" })).name).toBe("Renamed");
    expect(setAutomationEnabled(db, a.id, false).enabled).toBe(false);
    expect(getAutomation(db, a.id).trigger).toMatchObject({ type: "schedule", every: "week" });
    deleteAutomation(db, a.id);
    expect(() => getAutomation(db, a.id)).toThrow(AutomationError);
  });

  it("checks the destination and, for balance triggers, the account", () => {
    const { db, base } = setup();
    expect(() => createAutomation(db, base({ destinationId: 999 }))).toThrow(/destination no longer exists/);
    const trigger = { type: "balance_below" as const, accountId: "nope", cents: 100 };
    expect(() => createAutomation(db, base({ trigger }))).toThrow(/account no longer exists/);
    addAccount(db, "nope");
    expect(createAutomation(db, base({ trigger })).trigger).toMatchObject({ accountId: "nope" });
  });

  it("gives AI actions a model from the list, and non-AI actions none", () => {
    const { db, base } = setup();
    const ai = base({ action: { type: "ai_insight", lens: "spending", count: 2 } });
    expect(() => createAutomation(db, ai)).toThrow(/Set up AI/);
    updateAiConfig(db, { model: "m1", models: [{ id: "m1" }, { id: "m2" }], featureModels: { automations: "m2" } });
    expect(createAutomation(db, ai).model).toBe("m2"); // the "automations" default
    expect(createAutomation(db, { ...ai, model: "m1" }).model).toBe("m1");
    expect(() => createAutomation(db, { ...ai, model: "nope" })).toThrow(/isn't in your model list/);
    expect(createAutomation(db, base({ model: "m1" })).model).toBeNull(); // a message doesn't use a model
  });

  it("limits the count and protects destinations in use", () => {
    const { db, dest, base } = setup();
    for (let i = 0; i < MAX_AUTOMATIONS; i++) createAutomation(db, base({ name: `A${i}` }));
    expect(() => createAutomation(db, base())).toThrow(/up to 30/);
    expect(() => deleteDestination(db, dest.id)).toThrow(expect.objectContaining({ code: "conflict" }));
    for (const a of listAutomations(db)) deleteAutomation(db, a.id);
    deleteDestination(db, dest.id);
  });
});
