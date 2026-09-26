import { describe, expect, it } from "vitest";
import {
  computeCheckIn,
  DEFAULT_THREAD_CASH_CONFIG,
  EMPTY_STREAK_STATE,
  localDateString,
} from "../streaks";

const config = DEFAULT_THREAD_CASH_CONFIG;

describe("localDateString", () => {
  it("returns the buyer-local calendar date, not the UTC date", () => {
    // 2025-06-01T02:00:00Z is still 2025-05-31 in Los Angeles (UTC-7).
    const date = new Date("2025-06-01T02:00:00.000Z");
    expect(localDateString(date, "America/Los_Angeles")).toBe("2025-05-31");
    expect(localDateString(date, "UTC")).toBe("2025-06-01");
    // and already 2025-06-01 in Tokyo (UTC+9)
    expect(localDateString(date, "Asia/Tokyo")).toBe("2025-06-01");
  });

  it("falls back to UTC for an invalid timezone instead of throwing", () => {
    const date = new Date("2025-06-01T12:00:00.000Z");
    expect(() => localDateString(date, "Not/AZone")).not.toThrow();
    expect(localDateString(date, "Not/AZone")).toBe("2025-06-01");
  });
});

describe("computeCheckIn", () => {
  it("awards the daily amount on a first-ever check-in and starts the streak at 1", () => {
    const result = computeCheckIn(EMPTY_STREAK_STATE, config, new Date("2025-01-01T12:00:00Z"), "UTC");
    expect(result).toMatchObject({
      alreadyCheckedInToday: false,
      streakBroken: false,
      earnedCents: config.dailyAmountCents,
      streakBonusCents: 0,
      state: { currentStreak: 1, longestStreak: 1, lastCheckInDate: "2025-01-01" },
    });
  });

  it("is a no-op (double-claim safe) for a second check-in the same buyer-local day", () => {
    const first = computeCheckIn(EMPTY_STREAK_STATE, config, new Date("2025-01-01T08:00:00Z"), "UTC");
    const second = computeCheckIn(first.state, config, new Date("2025-01-01T23:00:00Z"), "UTC");
    expect(second).toMatchObject({ alreadyCheckedInToday: true, earnedCents: 0, streakBonusCents: 0 });
    expect(second.state).toEqual(first.state);
  });

  it("respects timezone-local day boundaries: a claim just after UTC midnight is not yet a new day in LA", () => {
    const day1 = computeCheckIn(
      EMPTY_STREAK_STATE, config,
      new Date("2025-01-02T23:30:00Z"), // 2025-01-02 15:30 in LA
      "America/Los_Angeles",
    );
    // 00:30 UTC the next day is still 2025-01-02 16:30 in LA — same local day.
    const sameLocalDay = computeCheckIn(
      day1.state, config,
      new Date("2025-01-03T00:30:00Z"),
      "America/Los_Angeles",
    );
    expect(sameLocalDay.alreadyCheckedInToday).toBe(true);
  });

  it("continues the streak on a consecutive local day", () => {
    const day1 = computeCheckIn(EMPTY_STREAK_STATE, config, new Date("2025-01-01T12:00:00Z"), "UTC");
    const day2 = computeCheckIn(day1.state, config, new Date("2025-01-02T12:00:00Z"), "UTC");
    expect(day2.state).toMatchObject({ currentStreak: 2, longestStreak: 2, lastCheckInDate: "2025-01-02" });
    expect(day2.streakBroken).toBe(false);
  });

  it("resets the streak to 1 after any missed calendar day", () => {
    const day1 = computeCheckIn(EMPTY_STREAK_STATE, config, new Date("2025-01-01T12:00:00Z"), "UTC");
    // Skip several full days.
    const later = computeCheckIn(day1.state, config, new Date("2025-01-04T12:00:00Z"), "UTC");
    expect(later.streakBroken).toBe(true);
    expect(later.state).toMatchObject({ currentStreak: 1, lastCheckInDate: "2025-01-04" });
    // longestStreak is preserved even though the current streak reset.
    expect(later.state.longestStreak).toBe(1);
  });

  it("preserves longestStreak across a reset", () => {
    let state = EMPTY_STREAK_STATE;
    for (let day = 1; day <= 5; day++) {
      state = computeCheckIn(state, config, new Date(`2025-01-0${day}T12:00:00Z`), "UTC").state;
    }
    expect(state.longestStreak).toBe(5);
    // Skip far ahead to break the streak.
    const broken = computeCheckIn(state, config, new Date("2025-02-01T12:00:00Z"), "UTC");
    expect(broken.state.currentStreak).toBe(1);
    expect(broken.state.longestStreak).toBe(5);
  });

  it("awards the streak bonus exactly every streakBonusDays, not before or after", () => {
    let state = EMPTY_STREAK_STATE;
    const bonuses: number[] = [];
    for (let day = 1; day <= 14; day++) {
      const result = computeCheckIn(state, config, new Date(2025, 0, day, 12), "UTC");
      state = result.state;
      bonuses.push(result.streakBonusCents);
    }
    // Bonus lands on day 7 and day 14 only.
    expect(bonuses[6]).toBe(config.streakBonusCents);
    expect(bonuses[13]).toBe(config.streakBonusCents);
    expect(bonuses.filter((c) => c > 0)).toHaveLength(2);
  });

  it("has no grace period: missing even one calendar day resets the streak to day 1", () => {
    const day1 = computeCheckIn(EMPTY_STREAK_STATE, config, new Date("2025-01-01T12:00:00Z"), "UTC");
    // Skip 2025-01-02 entirely; check in on 2025-01-03 (gap = 2 days).
    const afterGap = computeCheckIn(day1.state, config, new Date("2025-01-03T12:00:00Z"), "UTC");
    expect(afterGap.streakBroken).toBe(true);
    expect(afterGap.state.currentStreak).toBe(1);

    // A generous graceHours no longer matters — the rule is exact:
    // consecutive calendar days only, never a tolerated gap.
    const generousConfig = { ...config, graceHours: 24 };
    const stillBroken = computeCheckIn(day1.state, generousConfig, new Date("2025-01-03T12:00:00Z"), "UTC");
    expect(stillBroken.streakBroken).toBe(true);
    expect(stillBroken.state.currentStreak).toBe(1);
  });
});
