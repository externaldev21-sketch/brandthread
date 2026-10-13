import { describe, expect, it } from "vitest";
import {
  computeWeekStreak,
  isoWeekKey,
  mondayOf,
  mondayOfWeekKey,
  previousWeekKey,
  resolveTimeZone,
  weekWindow,
  weeklyQuestIdempotencyKey,
  zonedMidnight,
} from "../weeklyQuestsWeek";

describe("ISO week keys", () => {
  it("keys a mid-year week", () => {
    expect(mondayOf("2026-10-15")).toBe("2026-10-12");
    expect(isoWeekKey("2026-10-12")).toBe("2026-W42");
  });

  it("treats Sunday as the last day of the week", () => {
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
  });

  it("uses the ISO week-year at year boundaries", () => {
    // 2024-12-30 (Mon) belongs to 2025-W01; 2021-01-03 (Sun) to 2020-W53.
    expect(isoWeekKey(mondayOf("2024-12-31"))).toBe("2025-W01");
    expect(isoWeekKey(mondayOf("2021-01-03"))).toBe("2020-W53");
    expect(isoWeekKey(mondayOf("2026-01-01"))).toBe("2026-W01");
  });

  it("round-trips a key to its Monday and steps back a week", () => {
    expect(mondayOfWeekKey("2026-W42")).toBe("2026-10-12");
    expect(mondayOfWeekKey("2020-W53")).toBe("2020-12-28");
    expect(previousWeekKey("2026-W01")).toBe("2025-W52");
    expect(previousWeekKey("2021-W01")).toBe("2020-W53");
    expect(() => mondayOfWeekKey("2026-42")).toThrow();
  });

  it("builds the idempotency key", () => {
    expect(weeklyQuestIdempotencyKey("user_1", "2026-W42")).toBe("weekly_quests:user_1:2026-W42");
  });
});

describe("week window in the buyer's timezone", () => {
  it("falls back to UTC for a missing or unknown zone", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("uses the local date, not the UTC date, to pick the week", () => {
    // Monday 2026-10-19 02:00 UTC is still Sunday evening in New York.
    const now = new Date("2026-10-19T02:00:00Z");
    expect(weekWindow(now, "UTC").weekKey).toBe("2026-W43");
    const ny = weekWindow(now, "America/New_York");
    expect(ny.weekKey).toBe("2026-W42");
    expect(ny.startDate).toBe("2026-10-12");
    expect(ny.endDate).toBe("2026-10-18");
    expect(ny.startsAt.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(ny.endsAt.toISOString()).toBe("2026-10-19T04:00:00.000Z");
  });

  it("is already next week east of UTC", () => {
    // Sunday 2026-10-18 20:00 UTC is Monday morning in Tokyo.
    const w = weekWindow(new Date("2026-10-18T20:00:00Z"), "Asia/Tokyo");
    expect(w.weekKey).toBe("2026-W43");
    expect(w.startsAt.toISOString()).toBe("2026-10-18T15:00:00.000Z");
  });

  it("handles a week that crosses a DST change", () => {
    // US DST ends 2026-11-01: the week starts at EDT midnight and ends at EST midnight.
    const w = weekWindow(new Date("2026-10-30T12:00:00Z"), "America/New_York");
    expect(w.startsAt.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(w.endsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(zonedMidnight("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("week streak", () => {
  it("is zero with no claims", () => {
    expect(computeWeekStreak([], "2026-W42")).toBe(0);
  });

  it("counts back from the current week when it is claimed", () => {
    expect(computeWeekStreak(["2026-W42", "2026-W41", "2026-W40"], "2026-W42")).toBe(3);
  });

  it("keeps last week's run alive while this week is unclaimed", () => {
    expect(computeWeekStreak(["2026-W41", "2026-W40"], "2026-W42")).toBe(2);
  });

  it("stops at a missed week", () => {
    expect(computeWeekStreak(["2026-W42", "2026-W40", "2026-W39"], "2026-W42")).toBe(1);
    expect(computeWeekStreak(["2026-W40"], "2026-W42")).toBe(0);
  });

  it("runs across a year boundary", () => {
    expect(computeWeekStreak(["2021-W01", "2020-W53", "2020-W52"], "2021-W01")).toBe(3);
  });
});
