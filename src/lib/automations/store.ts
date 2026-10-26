import "server-only";
import { count, desc, eq } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { automationRuns, automations, notifyDestinations } from "@/db/schema";
import { accounts } from "@/db/schema";
import { getAiConfig, isAllowedModel, modelFor } from "@/lib/llm/config";
import {
  actionSchema,
  automationInputSchema,
  isAiAction,
  MAX_AUTOMATIONS,
  triggerSchema,
  type AutomationInput,
  type AutomationRunView,
  type AutomationView,
} from "./types";

export class AutomationError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

type Row = typeof automations.$inferSelect;

/** Rows whose JSON no longer validates are skipped rather than breaking the list. */
function toView(r: Row): AutomationView | null {
  try {
    return {
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      trigger: triggerSchema.parse(JSON.parse(r.triggerJson)),
      action: actionSchema.parse(JSON.parse(r.actionJson)),
      destinationId: r.destinationId,
      model: r.model,
      includeDetails: r.includeDetails,
      lastRunAt: r.lastRunAt,
      lastStatus: r.lastStatus,
      createdAt: r.createdAt,
    };
  } catch {
    return null;
  }
}

export function listAutomations(db: DbLike): AutomationView[] {
  return db
    .select()
    .from(automations)
    .orderBy(automations.id)
    .all()
    .flatMap((r) => toView(r) ?? []);
}

export function getAutomation(db: DbLike, id: number): AutomationView {
  const row = db.select().from(automations).where(eq(automations.id, id)).get();
  const view = row && toView(row);
  if (!view) throw new AutomationError("not_found", "Automation not found");
  return view;
}

/** Validates references and the model, and returns the columns to store. */
function prepare(db: DbLike, input: unknown) {
  const v = automationInputSchema.parse(input);
  if (
    !db
      .select({ id: notifyDestinations.id })
      .from(notifyDestinations)
      .where(eq(notifyDestinations.id, v.destinationId))
      .get()
  )
    throw new AutomationError("invalid", "That destination no longer exists");
  if (
    v.trigger.type === "balance_below" &&
    !db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, v.trigger.accountId)).get()
  )
    throw new AutomationError("invalid", "That account no longer exists");

  let model: string | null = null;
  if (isAiAction(v.action)) {
    const cfg = getAiConfig(db);
    model = v.model?.trim() || modelFor(cfg, "automations") || null;
    if (!model) throw new AutomationError("invalid", "Set up AI in Settings → AI before using an AI action.");
    if (!isAllowedModel(cfg, model)) throw new AutomationError("invalid", "That model isn't in your model list.");
  }
  return {
    name: v.name,
    enabled: v.enabled,
    triggerJson: JSON.stringify(v.trigger),
    actionJson: JSON.stringify(v.action),
    destinationId: v.destinationId,
    model,
    includeDetails: v.includeDetails,
  };
}

export function createAutomation(
  db: DbLike,
  input: AutomationInput,
  now = Math.floor(Date.now() / 1000),
): AutomationView {
  const values = prepare(db, input);
  if ((db.select({ n: count() }).from(automations).get()?.n ?? 0) >= MAX_AUTOMATIONS)
    throw new AutomationError("invalid", `You can have up to ${MAX_AUTOMATIONS} automations.`);
  return toView(
    db
      .insert(automations)
      .values({ ...values, createdAt: now })
      .returning()
      .get(),
  )!;
}

/** Replaces the definition (the editor always sends the whole thing). */
export function updateAutomation(db: DbLike, id: number, input: AutomationInput): AutomationView {
  getAutomation(db, id);
  const values = prepare(db, input);
  return toView(db.update(automations).set(values).where(eq(automations.id, id)).returning().get())!;
}

export function setAutomationEnabled(db: DbLike, id: number, enabled: boolean): AutomationView {
  getAutomation(db, id);
  return toView(db.update(automations).set({ enabled }).where(eq(automations.id, id)).returning().get())!;
}

export function deleteAutomation(db: DbLike, id: number): void {
  getAutomation(db, id);
  db.delete(automations).where(eq(automations.id, id)).run();
}

export function listRuns(db: DbLike, automationId: number, limit = 50): AutomationRunView[] {
  return db
    .select({
      id: automationRuns.id,
      startedAt: automationRuns.startedAt,
      status: automationRuns.status,
      reason: automationRuns.reason,
      preview: automationRuns.preview,
    })
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
    .limit(Math.min(limit, 50))
    .all();
}

export const automationsUsingDestination = (db: DbLike, destinationId: number): number =>
  db.select({ n: count() }).from(automations).where(eq(automations.destinationId, destinationId)).get()?.n ?? 0;
