import "server-only";
import cron, { type ScheduledTask } from "node-cron";
import { getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { getMarketRates, refreshMarketRatesSafe } from "./exchange-rates";

const g = globalThis as unknown as { __sbFxCron?: ScheduledTask };

/** Daily at 06:15 local time (the service publishes just after 00:00 UTC), plus a catch-up shortly after boot if the rates are over a day old. */
export function startExchangeRateScheduler(): void {
  if (g.__sbFxCron) return;
  const run = () => void refreshMarketRatesSafe(getDb());
  g.__sbFxCron = cron.schedule("15 6 * * *", run, { timezone: getEnv().TZ, noOverlap: true });
  const last = getMarketRates(getDb())?.updatedAt;
  if (!last || Date.now() / 1000 - last > 24 * 3600) setTimeout(run, 30_000).unref?.();
}
