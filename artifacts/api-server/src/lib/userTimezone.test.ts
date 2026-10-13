import { describe, expect, it } from "vitest";
import {
  FALLBACK_TIMEZONE, isAnniversaryWindow, isOrderAnniversary, isValidTimeZone, isWeeklyDigestWindow,
  isoWeekKey, localDateKey, resolveUserTimezone,
} from "./userTimezone";

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone("x".repeat(80))).toBe(false);
  });
});

describe("resolveUserTimezone", () => {
  it("prefers the device timezone", () => {
    expect(resolveUserTimezone({ userTimezone: "Asia/Tokyo", streakTimezone: "Europe/Paris", quietHoursTimezone: "Europe/Berlin" })).toBe("Asia/Tokyo");
  });
  it("falls back to the Thread Cash streak timezone", () => {
    expect(resolveUserTimezone({ userTimezone: null, streakTimezone: "Europe/Paris", quietHoursTimezone: "Europe/Berlin" })).toBe("Europe/Paris");
    expect(resolveUserTimezone({ userTimezone: "Nope/Bad", streakTimezone: "Europe/Paris" })).toBe("Europe/Paris");
  });
  it("uses quiet-hours timezone only when it isn't the UTC default", () => {
    expect(resolveUserTimezone({ quietHoursTimezone: "Europe/Berlin" })).toBe("Europe/Berlin");
    expect(resolveUserTimezone({ quietHoursTimezone: "UTC" })).toBe(FALLBACK_TIMEZONE);
  });
  it("falls back to America/New_York", () => {
    expect(resolveUserTimezone({})).toBe("America/New_York");
    expect(resolveUserTimezone({ userTimezone: "garbage", streakTimezone: null, quietHoursTimezone: "UTC" })).toBe("America/New_York");
  });
});

describe("isWeeklyDigestWindow", () => {
  it("is true only on local Sunday 18:xx", () => {
    // Sunday 2026-10-18 18:30 in New York (EDT, UTC-4) = 22:30Z
    expect(isWeeklyDigestWindow(new Date("2026-10-18T22:30:00Z"), "America/New_York")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-10-18T22:00:00Z"), "America/New_York")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-10-18T22:59:59Z"), "America/New_York")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-10-18T21:59:59Z"), "America/New_York")).toBe(false);
    expect(isWeeklyDigestWindow(new Date("2026-10-18T23:00:00Z"), "America/New_York")).toBe(false);
    // Same instant is Monday 07:30 in Tokyo
    expect(isWeeklyDigestWindow(new Date("2026-10-18T22:30:00Z"), "Asia/Tokyo")).toBe(false);
    // Saturday 18:30 local is not the window
    expect(isWeeklyDigestWindow(new Date("2026-10-17T22:30:00Z"), "America/New_York")).toBe(false);
  });

  it("follows DST: the UTC hour moves with the clocks", () => {
    // US DST ends Sunday 2026-11-01. 18:30 local that day is EST (UTC-5) = 23:30Z.
    expect(isWeeklyDigestWindow(new Date("2026-11-01T23:30:00Z"), "America/New_York")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-11-01T22:30:00Z"), "America/New_York")).toBe(false);
    // US DST starts Sunday 2026-03-08. 18:30 local that day is EDT (UTC-4) = 22:30Z.
    expect(isWeeklyDigestWindow(new Date("2026-03-08T22:30:00Z"), "America/New_York")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-03-08T23:30:00Z"), "America/New_York")).toBe(false);
    // EU DST ends Sunday 2026-10-25: London 18:30 is GMT (UTC+0).
    expect(isWeeklyDigestWindow(new Date("2026-10-25T18:30:00Z"), "Europe/London")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-10-25T17:30:00Z"), "Europe/London")).toBe(false);
  });

  it("handles half-hour offsets", () => {
    // Sunday 18:15 in Kolkata (UTC+5:30) = 12:45Z
    expect(isWeeklyDigestWindow(new Date("2026-10-18T12:45:00Z"), "Asia/Kolkata")).toBe(true);
    expect(isWeeklyDigestWindow(new Date("2026-10-18T12:15:00Z"), "Asia/Kolkata")).toBe(false);
  });
});

describe("isoWeekKey", () => {
  it("uses the buyer-local date", () => {
    // Sunday 18:30 in NY is still ISO week 42; in Tokyo it's Monday of week 43.
    expect(isoWeekKey(new Date("2026-10-18T22:30:00Z"), "America/New_York")).toBe("2026-W42");
    expect(isoWeekKey(new Date("2026-10-18T22:30:00Z"), "Asia/Tokyo")).toBe("2026-W43");
  });
  it("handles ISO years that differ from calendar years", () => {
    // Sunday 2027-01-03 belongs to ISO 2026-W53 (2026 has 53 ISO weeks).
    expect(isoWeekKey(new Date("2027-01-03T23:30:00Z"), "America/New_York")).toBe("2026-W53");
    // Monday 2024-12-30 is ISO 2025-W01.
    expect(isoWeekKey(new Date("2024-12-30T12:00:00Z"), "UTC")).toBe("2025-W01");
    // Sunday 2023-01-01 is ISO 2022-W52.
    expect(isoWeekKey(new Date("2023-01-01T12:00:00Z"), "UTC")).toBe("2022-W52");
  });
  it("is stable across a DST change within the week", () => {
    expect(isoWeekKey(new Date("2026-11-01T23:30:00Z"), "America/New_York")).toBe("2026-W44");
  });
});

describe("localDateKey / isAnniversaryWindow", () => {
  it("reads the local calendar date and hour", () => {
    expect(localDateKey(new Date("2026-10-13T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-12");
    expect(isAnniversaryWindow(new Date("2026-10-13T15:10:00Z"), "America/New_York")).toBe(true); // 11:10 EDT
    expect(isAnniversaryWindow(new Date("2026-10-13T16:10:00Z"), "America/New_York")).toBe(false);
  });
});

describe("isOrderAnniversary", () => {
  const tz = "America/New_York";
  it("matches the same local date one year later", () => {
    expect(isOrderAnniversary(new Date("2025-10-13T18:00:00Z"), new Date("2026-10-13T15:00:00Z"), tz)).toBe(true);
    expect(isOrderAnniversary(new Date("2025-10-12T18:00:00Z"), new Date("2026-10-13T15:00:00Z"), tz)).toBe(false);
    expect(isOrderAnniversary(new Date("2024-10-13T18:00:00Z"), new Date("2026-10-13T15:00:00Z"), tz)).toBe(false);
  });
  it("uses the buyer's local date, not UTC", () => {
    // Paid 2025-10-14 01:00Z = Oct 13, 21:00 in New York.
    expect(isOrderAnniversary(new Date("2025-10-14T01:00:00Z"), new Date("2026-10-13T15:00:00Z"), tz)).toBe(true);
    expect(isOrderAnniversary(new Date("2025-10-14T01:00:00Z"), new Date("2026-10-13T15:00:00Z"), "UTC")).toBe(false);
  });
  it("remembers a Feb 29 order on Feb 28 of a non-leap year", () => {
    const paid = new Date("2028-02-29T17:00:00Z");
    expect(isOrderAnniversary(paid, new Date("2029-02-28T16:00:00Z"), tz)).toBe(true);
    expect(isOrderAnniversary(paid, new Date("2029-03-01T16:00:00Z"), tz)).toBe(false);
  });
  it("does not double up Feb 28 and Feb 29 orders in a leap anniversary year", () => {
    // Feb 28 2027 order → Feb 28 2028 only; Feb 29 2028 is not its anniversary.
    const paid = new Date("2027-02-28T17:00:00Z");
    expect(isOrderAnniversary(paid, new Date("2028-02-28T16:00:00Z"), tz)).toBe(true);
    expect(isOrderAnniversary(paid, new Date("2028-02-29T16:00:00Z"), tz)).toBe(false);
  });
});
