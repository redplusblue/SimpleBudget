import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  daysInMonth,
  shiftMonth,
  currentMonth,
  isDateString,
  localDateString,
  monthRange,
  tzOffsetSeconds,
  zonedDayStart,
} from "@/lib/finance/dates";

const utc = (s: string) => Date.parse(s) / 1000;

describe("tzOffsetSeconds", () => {
  it("handles zones and DST", () => {
    expect(tzOffsetSeconds(utc("2026-01-15T12:00:00Z"), "UTC")).toBe(0);
    expect(tzOffsetSeconds(utc("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-5 * 3600);
    expect(tzOffsetSeconds(utc("2026-07-15T12:00:00Z"), "America/New_York")).toBe(-4 * 3600);
    expect(tzOffsetSeconds(utc("2026-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3600);
  });
  it("falls back to UTC for unknown zones", () => {
    expect(tzOffsetSeconds(utc("2026-07-15T12:00:00Z"), "Not/AZone")).toBe(0);
  });
});

describe("zonedDayStart / monthRange", () => {
  it("returns local midnight", () => {
    expect(zonedDayStart("2026-10-24", "UTC")).toBe(utc("2026-10-24T00:00:00Z"));
    expect(zonedDayStart("2026-10-24", "America/New_York")).toBe(utc("2026-10-24T04:00:00Z"));
    expect(zonedDayStart("2026-12-01", "America/New_York")).toBe(utc("2026-12-01T05:00:00Z"));
    expect(zonedDayStart("2026-10-24", "Asia/Tokyo")).toBe(utc("2026-10-23T15:00:00Z"));
  });
  it("is correct on DST change days", () => {
    // US clocks fall back on 2026-11-01 (midnight is still EDT) and spring forward on 2026-03-08.
    expect(zonedDayStart("2026-11-01", "America/New_York")).toBe(utc("2026-11-01T04:00:00Z"));
    expect(zonedDayStart("2026-11-02", "America/New_York")).toBe(utc("2026-11-02T05:00:00Z"));
    expect(zonedDayStart("2026-03-08", "America/New_York")).toBe(utc("2026-03-08T05:00:00Z"));
    expect(zonedDayStart("2026-03-09", "America/New_York")).toBe(utc("2026-03-09T04:00:00Z"));
  });
  it("monthRange spans exactly the local month, including year rollover", () => {
    expect(monthRange("2026-10", "UTC")).toEqual({
      start: utc("2026-10-01T00:00:00Z"),
      end: utc("2026-11-01T00:00:00Z"),
    });
    expect(monthRange("2026-12", "UTC").end).toBe(utc("2027-01-01T00:00:00Z"));
    const ny = monthRange("2026-11", "America/New_York");
    expect(ny.start).toBe(utc("2026-11-01T04:00:00Z"));
    expect(ny.end).toBe(utc("2026-12-01T05:00:00Z"));
    expect((ny.end - ny.start) / 3600).toBe(30 * 24 + 1); // November has the extra DST hour
  });
  it("rejects bad input", () => {
    expect(() => monthRange("2026-13", "UTC")).toThrow();
    expect(() => zonedDayStart("nope", "UTC")).toThrow();
  });
});

describe("date helpers", () => {
  it("validates date strings", () => {
    expect(isDateString("2026-02-28")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-2-3")).toBe(false);
  });
  it("adds days across month and leap boundaries", () => {
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("computes local month and date", () => {
    const t = utc("2026-11-01T02:30:00Z");
    expect(currentMonth(t, "UTC")).toBe("2026-11");
    expect(currentMonth(t, "America/New_York")).toBe("2026-10");
    expect(localDateString(t, "America/New_York")).toBe("2026-10-31");
  });
});

describe("month arithmetic", () => {
  it("counts days in months including leap years", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-10")).toBe(31);
    expect(daysInMonth("2026-11")).toBe(30);
  });
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-03", -14)).toBe("2025-01");
    expect(shiftMonth("2026-03", 0)).toBe("2026-03");
  });
  it("rejects bad months", () => {
    expect(() => daysInMonth("2026-1")).toThrow();
    expect(() => shiftMonth("x", 1)).toThrow();
  });
});
