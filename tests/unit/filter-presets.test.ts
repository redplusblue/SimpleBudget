import { describe, expect, it } from "vitest";
import { detectPreset, presetRange } from "@/components/register/filter-presets";

const NOW = new Date("2026-03-15T10:00:00");

describe("date presets", () => {
  it("computes ranges", () => {
    expect(presetRange("all", NOW)).toEqual({});
    expect(presetRange("this-month", NOW)).toEqual({ from: "2026-03-01" });
    expect(presetRange("last-month", NOW)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("30d", NOW)).toEqual({ from: "2026-02-14" });
    expect(presetRange("90d", NOW)).toEqual({ from: "2025-12-16" });
    expect(presetRange("ytd", NOW)).toEqual({ from: "2026-01-01" });
  });
  it("handles year boundaries and leap years", () => {
    const jan = new Date("2026-01-10T10:00:00");
    expect(presetRange("last-month", jan)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("last-month", new Date("2028-03-05T10:00:00"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
  it("detects presets and falls back to custom", () => {
    expect(detectPreset(undefined, undefined, NOW)).toBe("all");
    expect(detectPreset("2026-03-01", undefined, NOW)).toBe("this-month");
    expect(detectPreset("2026-02-01", "2026-02-28", NOW)).toBe("last-month");
    expect(detectPreset("2026-03-02", undefined, NOW)).toBe("custom");
    expect(detectPreset(undefined, "2026-03-01", NOW)).toBe("custom");
  });
});
