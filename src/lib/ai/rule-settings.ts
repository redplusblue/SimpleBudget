import "server-only";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

export const RULE_SCHEDULES = ["manual", "after_sync", "interval"] as const;
export type RuleSchedule = (typeof RULE_SCHEDULES)[number];

const KEYS = {
  schedule: "ai:rules:schedule",
  intervalDays: "ai:rules:interval_days",
  minNewMerchants: "ai:rules:min_new_merchants",
  maxMerchantsPerRun: "ai:rules:max_merchants_per_run",
  suggestTags: "ai:rules:suggest_tags",
  lastRunAt: "ai:rules:last_run_at",
} as const;

export interface RuleSuggestSettings {
  schedule: RuleSchedule;
  intervalDays: number;
  minNewMerchants: number;
  maxMerchantsPerRun: number;
  suggestTags: boolean;
  /** Unix seconds of the last background run, or null. */
  lastRunAt: number | null;
}

const int = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function getRuleSuggestSettings(db: DbLike): RuleSuggestSettings {
  const schedule = getSetting(db, KEYS.schedule);
  const last = Number(getSetting(db, KEYS.lastRunAt));
  return {
    schedule: RULE_SCHEDULES.find((s) => s === schedule) ?? "after_sync",
    intervalDays: int(getSetting(db, KEYS.intervalDays), 7, 1, 90),
    minNewMerchants: int(getSetting(db, KEYS.minNewMerchants), 5, 1, 100),
    maxMerchantsPerRun: int(getSetting(db, KEYS.maxMerchantsPerRun), 100, 1, 500),
    suggestTags: getSetting(db, KEYS.suggestTags) === "1",
    lastRunAt: Number.isFinite(last) && last > 0 ? last : null,
  };
}

const patchSchema = z
  .object({
    schedule: z.enum(RULE_SCHEDULES),
    intervalDays: z.number().int().min(1).max(90),
    minNewMerchants: z.number().int().min(1).max(100),
    maxMerchantsPerRun: z.number().int().min(1).max(500),
    suggestTags: z.boolean(),
  })
  .partial()
  .strict();

export function updateRuleSuggestSettings(db: DbLike, input: unknown): RuleSuggestSettings {
  const patch = patchSchema.parse(input);
  db.transaction((tx) => {
    if (patch.schedule !== undefined) setSetting(tx, KEYS.schedule, patch.schedule);
    if (patch.intervalDays !== undefined) setSetting(tx, KEYS.intervalDays, String(patch.intervalDays));
    if (patch.minNewMerchants !== undefined) setSetting(tx, KEYS.minNewMerchants, String(patch.minNewMerchants));
    if (patch.maxMerchantsPerRun !== undefined)
      setSetting(tx, KEYS.maxMerchantsPerRun, String(patch.maxMerchantsPerRun));
    if (patch.suggestTags !== undefined) setSetting(tx, KEYS.suggestTags, patch.suggestTags ? "1" : "0");
  });
  return getRuleSuggestSettings(db);
}

export function setRuleSuggestLastRun(db: DbLike, at: number | null): void {
  if (at === null) deleteSetting(db, KEYS.lastRunAt);
  else setSetting(db, KEYS.lastRunAt, String(at));
}
