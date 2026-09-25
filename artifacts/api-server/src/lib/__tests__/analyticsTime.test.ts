import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  TEN_MIN_MS,
  addLocalMonths,
  floorToLocalMonth,
  floorToLocalStep,
  parseTzOffsetMinutes,
  previousPeriod,
} from "../analyticsTime";

describe("parseTzOffsetMinutes", () => {
  it("passes through a valid offset", () => {
    expect(parseTzOffsetMinutes("-300")).toBe(-300);
    expect(parseTzOffsetMinutes(330)).toBe(330);
  });

  it("falls back to UTC (0) for missing/invalid input", () => {
    expect(parseTzOffsetMinutes(undefined)).toBe(0);
    expect(parseTzOffsetMinutes("not-a-number")).toBe(0);
    expect(parseTzOffsetMinutes(null)).toBe(0);
  });

  it("clamps to a plausible timezone range", () => {
    expect(parseTzOffsetMinutes(10_000)).toBe(840);
    expect(parseTzOffsetMinutes(-10_000)).toBe(-840);
  });

  it("rounds fractional offsets", () => {
    expect(parseTzOffsetMinutes(329.6)).toBe(330);
  });
});

describe("floorToLocalStep", () => {
  it("floors to an exact hour mark in a positive UTC offset (never an odd minute)", () => {
    // 2026-01-15T13:53:00Z in UTC+5:30 is 19:23 local -> floors to 19:00 local -> back to UTC.
    const date = new Date("2026-01-15T13:53:00Z");
    const floored = floorToLocalStep(date, 60 * 60 * 1000, 330);
    expect(floored.toISOString()).toBe("2026-01-15T13:30:00.000Z");
  });

  it("floors a live-range timestamp to a clean 10-minute mark, never :53", () => {
    const date = new Date("2026-01-15T15:53:00Z");
    const floored = floorToLocalStep(date, TEN_MIN_MS, 0);
    expect(floored.getUTCMinutes() % 10).toBe(0);
    expect(floored.toISOString()).toBe("2026-01-15T15:50:00.000Z");
  });

  it("floors to local midnight for a negative UTC offset, landing on the seller's calendar day", () => {
    // 2026-01-15T04:00:00Z is 2026-01-14T20:00:00 in UTC-8 (Los Angeles-ish),
    // so "today" for that seller started at 2026-01-15T08:00:00Z, not the server's own midnight.
    const date = new Date("2026-01-15T04:00:00Z");
    const floored = floorToLocalStep(date, DAY_MS, -480);
    expect(floored.toISOString()).toBe("2026-01-14T08:00:00.000Z");
  });

  it("is a no-op at UTC on an exact boundary", () => {
    const date = new Date("2026-01-15T00:00:00Z");
    expect(floorToLocalStep(date, DAY_MS, 0).getTime()).toBe(date.getTime());
  });
});

describe("previousPeriod", () => {
  it("gives yesterday for today's [midnight, tomorrow) window", () => {
    const start = new Date("2026-01-15T00:00:00Z");
    const end = new Date("2026-01-16T00:00:00Z");
    const previous = previousPeriod(start, end);
    expect(previous.start.toISOString()).toBe("2026-01-14T00:00:00.000Z");
    expect(previous.end.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("gives the prior 7-day window for a week-long period", () => {
    const start = new Date("2026-01-09T00:00:00Z");
    const end = new Date("2026-01-16T00:00:00Z");
    const previous = previousPeriod(start, end);
    expect(previous.end.getTime() - previous.start.getTime()).toBe(end.getTime() - start.getTime());
    expect(previous.end.toISOString()).toBe(start.toISOString());
  });

  it("gives the prior hour for Live's rolling 1-hour window", () => {
    const start = new Date("2026-01-15T15:00:00Z");
    const end = new Date("2026-01-15T16:00:00Z");
    const previous = previousPeriod(start, end);
    expect(previous.start.toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(previous.end.toISOString()).toBe("2026-01-15T15:00:00.000Z");
  });
});

describe("floorToLocalMonth", () => {
  it("floors to the 1st of the local month at UTC", () => {
    const date = new Date("2026-01-15T13:53:00Z");
    expect(floorToLocalMonth(date, 0).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("floors to the local month even when UTC is already in the next month", () => {
    // 2026-02-01T04:00:00Z is 2026-01-31T20:00:00 in UTC-8, so the local
    // month is still January, not February.
    const date = new Date("2026-02-01T04:00:00Z");
    expect(floorToLocalMonth(date, -480).toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });

  it("is idempotent on an exact month boundary", () => {
    const date = new Date("2026-03-01T00:00:00.000Z");
    expect(floorToLocalMonth(date, 0).getTime()).toBe(date.getTime());
  });
});

describe("addLocalMonths", () => {
  it("adds whole calendar months in the local timezone", () => {
    const jan1 = new Date("2026-01-01T00:00:00.000Z");
    expect(addLocalMonths(jan1, 1, 0).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(addLocalMonths(jan1, 11, 0).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("subtracts months, crossing a year boundary correctly", () => {
    const jan1 = new Date("2026-01-01T00:00:00.000Z");
    expect(addLocalMonths(jan1, -1, 0).toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(addLocalMonths(jan1, -11, 0).toISOString()).toBe("2025-02-01T00:00:00.000Z");
  });

  it("stays anchored to the same local calendar day across a DST-adjacent offset", () => {
    // A local timezone offset far from UTC should never shift the calendar
    // day when only the month changes.
    const start = floorToLocalMonth(new Date("2026-01-15T00:00:00Z"), -480);
    const next = addLocalMonths(start, 1, -480);
    expect(next.toISOString()).toBe("2026-02-01T08:00:00.000Z");
  });
});
