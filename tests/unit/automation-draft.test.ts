import { describe, expect, it } from "vitest";
import {
  automationToDraft,
  draftToAutomationInput,
  emptyAutomationDraft,
  exampleDraft,
} from "@/components/automations/automation-draft";
import { describeAutomation } from "@/components/automations/describe";
import type { AutomationView } from "@/lib/automations/types";

describe("automation drafts", () => {
  it("builds a valid input from the example and refuses incomplete ones", () => {
    const r = draftToAutomationInput(exampleDraft(3));
    expect(r.ok && r.input).toMatchObject({
      name: "Weekly spending insight",
      trigger: { type: "schedule", every: "week", weekday: 0, hour: 9, minute: 0 },
      action: { type: "ai_insight", lens: "spending", count: 2 },
      destinationId: 3,
      model: null,
    });
    expect(draftToAutomationInput(emptyAutomationDraft())).toEqual({ ok: false, error: "Choose where to send it" });
    expect(draftToAutomationInput({ ...exampleDraft(3), name: " " }).ok).toBe(false);
    expect(draftToAutomationInput({ ...exampleDraft(3), actionType: "message", text: "" }).ok).toBe(false);
  });

  it("converts amounts and accounts, and round-trips through the stored shape", () => {
    const d = {
      ...emptyAutomationDraft(),
      name: "Big spend",
      destinationId: 1,
      triggerType: "transaction" as const,
      conditions: [{ ...emptyAutomationDraft().conditions[0], text: "200" }],
      actionType: "message" as const,
      text: "{payee} {amount}",
    };
    const r = draftToAutomationInput(d);
    expect(r.ok && r.input.trigger).toMatchObject({
      type: "transaction",
      conditions: [{ field: "amount", op: "gt", value: 20_000 }],
    });
    const balance = draftToAutomationInput({
      ...emptyAutomationDraft(),
      name: "Low",
      destinationId: 1,
      triggerType: "balance_below",
      accountId: "A",
      balanceDollars: "$50.25",
      text: "low",
    });
    expect(balance.ok && balance.input.trigger).toEqual({ type: "balance_below", accountId: "A", cents: 5025 });
    expect(
      draftToAutomationInput({
        ...emptyAutomationDraft(),
        destinationId: 1,
        name: "x",
        text: "t",
        triggerType: "balance_below",
      }).ok,
    ).toBe(false);

    if (!r.ok) throw new Error("expected ok");
    const view: AutomationView = {
      id: 1,
      name: r.input.name,
      enabled: true,
      trigger: r.input.trigger as AutomationView["trigger"],
      action: r.input.action as AutomationView["action"],
      destinationId: 1,
      model: null,
      includeDetails: false,
      lastRunAt: null,
      lastStatus: null,
      createdAt: 0,
    };
    const back = draftToAutomationInput(automationToDraft(view));
    expect(back.ok && back.input.trigger).toEqual(r.input.trigger);
  });

  it("describes an automation in one line", () => {
    const a: AutomationView = {
      id: 1,
      name: "x",
      enabled: true,
      trigger: { type: "schedule", every: "week", hour: 9, minute: 0, weekday: 0 },
      action: { type: "ai_insight", lens: "spending", count: 2 },
      destinationId: 1,
      model: "m1",
      includeDetails: false,
      lastRunAt: null,
      lastStatus: null,
      createdAt: 0,
    };
    expect(describeAutomation(a, { destination: "Discord", model: "Smart" })).toBe(
      "Every Sunday at 09:00 → AI insight (Spending) → Discord · Smart",
    );
  });
});
