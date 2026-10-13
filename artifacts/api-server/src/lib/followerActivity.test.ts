import { describe, expect, it } from "vitest";
import { localWeekdayHour, MIN_ACTIVE_FOLLOWERS, summarizeFollowerActivity, type ActivityPair } from "./followerActivity";

const users = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const at = (iso: string) => new Date(iso);
const pairs = (ids: string[], iso: string): ActivityPair[] => ids.map((userId) => ({ userId, hourUtc: at(iso) }));

describe("localWeekdayHour", () => {
  it("buckets an instant into the zone's local weekday and hour", () => {
    // Fri 2026-10-16 02:00 UTC = Thu 7 PM in Los Angeles (PDT, UTC-7).
    expect(localWeekdayHour(at("2026-10-16T02:00:00Z"), "America/Los_Angeles")).toEqual({ weekday: 4, hour: 19 });
    expect(localWeekdayHour(at("2026-10-16T02:00:00Z"), "UTC")).toEqual({ weekday: 5, hour: 2 });
    // Fri 2026-10-16 02:00 UTC = Fri 11 AM in Tokyo (UTC+9).
    expect(localWeekdayHour(at("2026-10-16T02:00:00Z"), "Asia/Tokyo")).toEqual({ weekday: 5, hour: 11 });
  });

  it("follows daylight saving changes", () => {
    // 03:00 UTC is 7 PM PST in December (UTC-8) but 8 PM PDT in October.
    expect(localWeekdayHour(at("2026-12-04T03:00:00Z"), "America/Los_Angeles")).toEqual({ weekday: 4, hour: 19 });
    expect(localWeekdayHour(at("2026-10-16T03:00:00Z"), "America/Los_Angeles")).toEqual({ weekday: 4, hour: 20 });
  });

  it("handles half-hour zones by their local hour", () => {
    // 14:00 UTC = 19:30 in Kolkata (UTC+5:30) → the 7 PM hour.
    expect(localWeekdayHour(at("2026-10-15T14:00:00Z"), "Asia/Kolkata")).toEqual({ weekday: 4, hour: 19 });
  });
});

describe("summarizeFollowerActivity", () => {
  it("hides everything below the k-anonymity floor", () => {
    const s = summarizeFollowerActivity(pairs(users(MIN_ACTIVE_FOLLOWERS - 1), "2026-10-16T02:00:00Z"), "UTC");
    expect(s.status).toBe("not_enough_activity");
    expect(s.activeFollowers).toBeNull();
    expect(s.grid).toBeNull();
    expect(s.top).toEqual([]);
  });

  it("counts distinct followers, not events, toward the floor", () => {
    const one = Array.from({ length: 50 }, (_, h) => ({ userId: "solo", hourUtc: new Date(Date.UTC(2026, 9, 10, h % 24)) }));
    expect(summarizeFollowerActivity(one, "UTC").status).toBe("not_enough_activity");
  });

  it("ranks slots by distinct followers in the seller's zone and returns the top 3", () => {
    const all = users(30);
    const input = [
      ...pairs(all.slice(0, 25), "2026-10-16T02:00:00Z"), // Thu 7 PM LA
      ...pairs(all.slice(0, 25), "2026-10-09T02:00:00Z"), // the Thu before: same followers again
      ...pairs(all.slice(0, 12), "2026-10-17T16:00:00Z"), // Sat 9 AM LA
      ...pairs(all.slice(10, 20), "2026-10-13T01:00:00Z"), // Mon 6 PM LA
      ...pairs(all.slice(0, 3), "2026-10-14T20:00:00Z"), // Wed 1 PM LA
    ];
    const s = summarizeFollowerActivity(input, "America/Los_Angeles");
    expect(s.status).toBe("ok");
    if (s.status !== "ok") return;
    expect(s.activeFollowers).toBe(25);
    expect(s.top).toEqual([
      { weekday: 4, hour: 19, followers: 25 }, // repeat visits by the same people don't double count
      { weekday: 6, hour: 9, followers: 12 },
      { weekday: 1, hour: 18, followers: 10 },
    ]);
    expect(s.grid[4][19]).toBe(25);
    expect(s.grid[3][13]).toBe(3);
    expect(s.byWeekday[4]).toBe(25);

    // The same activity in UTC lands in different buckets.
    const utc = summarizeFollowerActivity(input, "UTC");
    if (utc.status !== "ok") throw new Error("expected ok");
    expect(utc.top[0]).toEqual({ weekday: 5, hour: 2, followers: 25 });
  });

  it("breaks ties toward the earlier slot in the week", () => {
    const all = users(20);
    const s = summarizeFollowerActivity([
      ...pairs(all, "2026-10-16T10:00:00Z"), // Fri 10:00
      ...pairs(all, "2026-10-12T10:00:00Z"), // Mon 10:00
    ], "UTC");
    if (s.status !== "ok") throw new Error("expected ok");
    expect(s.top.map((t) => t.weekday)).toEqual([1, 5]);
  });
});
