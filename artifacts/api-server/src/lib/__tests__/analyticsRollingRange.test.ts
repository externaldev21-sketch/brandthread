import { describe, expect, it } from "vitest";
import { DAY_MS, ROLLING_DAY_RANGES, previousPeriod, rollingDayWindow } from "../analyticsTime";

describe("rollingDayWindow (7D / 30D / 90D on the seller dashboard)", () => {
  const now = new Date("2026-10-13T15:42:00.000Z");

  it.each(Object.entries(ROLLING_DAY_RANGES))("%s covers exactly that many local days, today included", (_key, days) => {
    const { start, end } = rollingDayWindow(now, days, 0);
    expect((end.getTime() - start.getTime()) / DAY_MS).toBe(days);
    expect(end.toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });

  it("90D starts at local midnight 89 days ago", () => {
    const { start } = rollingDayWindow(now, 90, 0);
    expect(start.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("anchors days to the seller's timezone, not UTC", () => {
    // 15:42Z is 08:42 in UTC-7 (offset -420): local today is still Oct 13.
    const { start, end } = rollingDayWindow(now, 7, -420);
    expect(end.toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(start.toISOString()).toBe("2026-10-07T07:00:00.000Z");
  });

  it("the previous period is the same number of days immediately before", () => {
    const { start, end } = rollingDayWindow(now, 90, 0);
    const prev = previousPeriod(start, end);
    expect(prev.end.getTime()).toBe(start.getTime());
    expect((prev.end.getTime() - prev.start.getTime()) / DAY_MS).toBe(90);
    expect(prev.start.toISOString()).toBe("2026-04-17T00:00:00.000Z");
  });
});
