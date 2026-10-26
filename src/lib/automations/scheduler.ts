import "server-only";
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runScheduledAutomation } from "./fire";
import { listAutomations } from "./store";
import { scheduleToCron } from "./types";

const g = globalThis as unknown as { __sbAutomationCrons?: Map<number, ScheduledTask> };

/**
 * Stops every scheduled automation and starts one timer per enabled schedule automation. Call it at boot and after
 * any create/update/delete/enable change (the API routes do; the store itself stays free of timers).
 * Missed runs (the server was off) are not caught up.
 */
export function rescheduleAutomations(): number {
  const tasks = (g.__sbAutomationCrons ??= new Map());
  for (const task of tasks.values()) task.stop();
  tasks.clear();
  const tz = getEnv().TZ;
  let started = 0;
  try {
    for (const a of listAutomations(getDb())) {
      if (!a.enabled || a.trigger.type !== "schedule") continue;
      const id = a.id;
      tasks.set(
        id,
        cron.schedule(
          scheduleToCron(a.trigger),
          () => {
            void runScheduledAutomation(getDb(), id, Math.floor(Date.now() / 1000), tz);
          },
          { timezone: tz, noOverlap: true },
        ),
      );
      started++;
    }
  } catch (err) {
    logger.warn({ err }, "couldn't schedule automations");
  }
  return started;
}

/** How many schedule timers are running (for tests and diagnostics). */
export const scheduledCount = () => g.__sbAutomationCrons?.size ?? 0;
