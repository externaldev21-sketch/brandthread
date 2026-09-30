import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  TEN_MIN_MS,
  addLocalMonths,
  capEndAtNow,
  floorToLocalMonth,
  floorToLocalStep,
  floorToLocalWeek,
  floorToLocalYear,
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

describe("floorToLocalWeek", () => {
  it("floors to the most recent Sunday (not Monday — the app's week starts Sunday)", () => {
    // 2026-01-15 is a Thursday; the Sunday that started its week is 2026-01-11.
    const thursday = new Date("2026-01-15T13:00:00Z");
    expect(floorToLocalWeek(thursday, 0).toISOString()).toBe("2026-01-11T00:00:00.000Z");
  });

  it("is a no-op on a Sunday itself", () => {
    const sunday = new Date("2026-01-11T00:00:00.000Z");
    expect(floorToLocalWeek(sunday, 0).getTime()).toBe(sunday.getTime());
  });

  it("rolls back to the PRIOR Sunday when the local day is Saturday", () => {
    // 2026-01-17 is a Saturday; its week started 2026-01-11.
    const saturday = new Date("2026-01-17T23:59:00Z");
    expect(floorToLocalWeek(saturday, 0).toISOString()).toBe("2026-01-11T00:00:00.000Z");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-02-01 is a Sunday itself (2026-01-31 is a Saturday).
    const date = new Date("2026-02-03T12:00:00Z"); // Tuesday
    expect(floorToLocalWeek(date, 0).toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("uses the seller's own local timezone, not the server's, for the week boundary", () => {
    // 2026-01-11T04:00:00Z is 2026-01-10T20:00:00 local in UTC-8 — still
    // Saturday there, so the seller's week hasn't started yet; the most
    // recent Sunday for them is 2026-01-04, not the UTC date's 2026-01-11.
    const date = new Date("2026-01-11T04:00:00Z");
    expect(floorToLocalWeek(date, -480).toISOString()).toBe("2026-01-04T08:00:00.000Z");
  });
});

describe("floorToLocalYear", () => {
  it("floors to local January 1st at midnight", () => {
    const date = new Date("2026-07-15T13:00:00Z");
    expect(floorToLocalYear(date, 0).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is a no-op on the exact year boundary", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(floorToLocalYear(date, 0).getTime()).toBe(date.getTime());
  });

  it("uses the seller's local calendar year, not the server's, near a year boundary", () => {
    // 2026-01-01T04:00:00Z is 2025-12-31T20:00:00 local in UTC-8 — still
    // last year there.
    const date = new Date("2026-01-01T04:00:00Z");
    expect(floorToLocalYear(date, -480).toISOString()).toBe("2025-01-01T08:00:00.000Z");
  });
});

describe("capEndAtNow", () => {
  it("caps a fixed-step (hourly) range's natural end at the end of the current hour — no future hours", () => {
    const now = new Date("2026-01-15T14:23:00Z"); // mid-hour
    const naturalEnd = new Date("2026-01-16T00:00:00Z"); // tomorrow midnight (today's full natural end)
    const capped = capEndAtNow(naturalEnd, now, { stepMs: 60 * 60 * 1000, tzOffsetMinutes: 0 });
    // The current hour bucket is [14:00, 15:00) — its end is 15:00, well
    // before the natural (tomorrow) end, so the cap wins.
    expect(capped.toISOString()).toBe("2026-01-15T15:00:00.000Z");
  });

  it("does not cap when the natural end is already in the past relative to now (e.g. yesterday)", () => {
    const now = new Date("2026-01-16T10:00:00Z");
    const naturalEnd = new Date("2026-01-15T00:00:00Z"); // yesterday's own natural end (today's midnight)
    const capped = capEndAtNow(naturalEnd, now, { stepMs: DAY_MS, tzOffsetMinutes: 0 });
    expect(capped.toISOString()).toBe(naturalEnd.toISOString());
  });

  it("caps a variable-length step (month) using an explicit currentBucketEnd", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    const naturalEnd = new Date("2027-01-01T00:00:00Z"); // this calendar year's natural end
    const currentBucketEnd = addLocalMonths(floorToLocalMonth(now, 0), 1, 0); // 2026-04-01
    const capped = capEndAtNow(naturalEnd, now, { currentBucketEnd, tzOffsetMinutes: 0 });
    expect(capped.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});
