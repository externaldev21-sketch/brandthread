import { describe, expect, it } from "vitest";
import {
  getAwayState, validateAwayInput, shouldConsiderAutoReply, zonedToUtc, localParts, isValidTimezone,
  type AwaySettings,
} from "../awaySchedule";

const MON_FRI = 0b0111110; // bits 1..5
const base: AwaySettings = {
  enabled: true,
  message: "Back soon",
  mode: "outside_hours",
  timezone: "UTC",
  openDays: MON_FRI,
  openMinute: 9 * 60,
  closeMinute: 17 * 60,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};
const at = (iso: string) => new Date(iso);

describe("getAwayState", () => {
  it("is never away when disabled", () => {
    expect(getAwayState({ ...base, enabled: false }, at("2026-03-04T03:00:00Z"))).toEqual({ away: false, windowKey: null });
  });

  it("always mode: away, window keyed on last save", () => {
    const a = getAwayState({ ...base, mode: "always" }, at("2026-03-04T12:00:00Z"));
    const b = getAwayState({ ...base, mode: "always" }, at("2026-09-04T12:00:00Z"));
    expect(a.away).toBe(true);
    expect(a.windowKey).toBe(b.windowKey);
    const resaved = getAwayState({ ...base, mode: "always", updatedAt: new Date("2026-02-01T00:00:00Z") }, at("2026-03-04T12:00:00Z"));
    expect(resaved.windowKey).not.toBe(a.windowKey);
  });

  it("not away during business hours (Wed 2026-03-04 10:00 UTC)", () => {
    expect(getAwayState(base, at("2026-03-04T10:00:00Z")).away).toBe(false);
  });

  it("open at the open minute, away at the close minute", () => {
    expect(getAwayState(base, at("2026-03-04T09:00:00Z")).away).toBe(false);
    expect(getAwayState(base, at("2026-03-04T17:00:00Z")).away).toBe(true);
    expect(getAwayState(base, at("2026-03-04T08:59:00Z")).away).toBe(true);
  });

  it("evening and early morning of the same closed period share one window key", () => {
    const evening = getAwayState(base, at("2026-03-04T20:00:00Z"));
    const dawn = getAwayState(base, at("2026-03-05T04:00:00Z"));
    expect(evening.away && dawn.away).toBe(true);
    expect(evening.windowKey).toBe(dawn.windowKey);
    expect(evening.windowKey).toBe(`closed:${Date.UTC(2026, 2, 4, 17)}`);
  });

  it("the next day's closed period gets a different window key", () => {
    const wed = getAwayState(base, at("2026-03-04T20:00:00Z"));
    const thu = getAwayState(base, at("2026-03-05T20:00:00Z"));
    expect(wed.windowKey).not.toBe(thu.windowKey);
  });

  it("the whole weekend is one window (Fri close to Mon open)", () => {
    const sat = getAwayState(base, at("2026-03-07T12:00:00Z"));
    const sun = getAwayState(base, at("2026-03-08T23:00:00Z"));
    const monEarly = getAwayState(base, at("2026-03-09T08:00:00Z"));
    expect(sat.windowKey).toBe(sun.windowKey);
    expect(sun.windowKey).toBe(monEarly.windowKey);
    expect(sat.windowKey).toBe(`closed:${Date.UTC(2026, 2, 6, 17)}`);
    expect(getAwayState(base, at("2026-03-09T09:30:00Z")).away).toBe(false);
  });

  it("evaluates hours in the seller's timezone (New York)", () => {
    const ny = { ...base, timezone: "America/New_York" };
    // 2026-03-04 14:00 UTC = 09:00 EST -> open
    expect(getAwayState(ny, at("2026-03-04T14:00:00Z")).away).toBe(false);
    // 13:59 UTC = 08:59 EST -> away
    expect(getAwayState(ny, at("2026-03-04T13:59:00Z")).away).toBe(true);
    // 22:00 UTC = 17:00 EST -> away
    expect(getAwayState(ny, at("2026-03-04T22:00:00Z")).away).toBe(true);
  });

  it("uses the correct offset across DST (New York, after spring forward)", () => {
    const ny = { ...base, timezone: "America/New_York" };
    // DST began 2026-03-08; on Mon 2026-03-09 EDT = UTC-4, so 09:00 local = 13:00 UTC.
    expect(getAwayState(ny, at("2026-03-09T12:59:00Z")).away).toBe(true);
    expect(getAwayState(ny, at("2026-03-09T13:00:00Z")).away).toBe(false);
  });

  it("uses the seller's local weekday, not UTC's (Tokyo)", () => {
    const tokyo = { ...base, timezone: "Asia/Tokyo" };
    // Sun 2026-03-08 23:30 UTC = Mon 08:30 JST -> before open -> away
    expect(getAwayState(tokyo, at("2026-03-08T23:30:00Z")).away).toBe(true);
    // Mon 2026-03-09 00:30 UTC = Mon 09:30 JST -> open
    expect(getAwayState(tokyo, at("2026-03-09T00:30:00Z")).away).toBe(false);
  });

  describe("overnight business hours (22:00 -> 02:00)", () => {
    const night = { ...base, openMinute: 22 * 60, closeMinute: 2 * 60 };
    it("is open across midnight into the next day", () => {
      // Wed 23:00 open; Thu 01:00 still the Wed shift
      expect(getAwayState(night, at("2026-03-04T23:00:00Z")).away).toBe(false);
      expect(getAwayState(night, at("2026-03-05T01:00:00Z")).away).toBe(false);
      expect(getAwayState(night, at("2026-03-05T02:00:00Z")).away).toBe(true);
    });
    it("Friday's shift runs into Saturday morning, Saturday night is closed", () => {
      expect(getAwayState(night, at("2026-03-07T01:00:00Z")).away).toBe(false); // Sat 01:00 = Fri shift
      expect(getAwayState(night, at("2026-03-07T23:00:00Z")).away).toBe(true); // Sat 23:00: Sat not open
    });
    it("the away window key is when the last shift ended", () => {
      const s = getAwayState(night, at("2026-03-05T12:00:00Z"));
      expect(s.windowKey).toBe(`closed:${Date.UTC(2026, 2, 5, 2)}`);
    });
  });

  it("open == close means open all day on open days", () => {
    const allDay = { ...base, openMinute: 0, closeMinute: 0 };
    expect(getAwayState(allDay, at("2026-03-04T03:00:00Z")).away).toBe(false);
    expect(getAwayState(allDay, at("2026-03-07T03:00:00Z")).away).toBe(true); // Saturday
  });

  it("no open days: away with one continuous window", () => {
    const closed = { ...base, openDays: 0 };
    const a = getAwayState(closed, at("2026-03-04T10:00:00Z"));
    const b = getAwayState(closed, at("2026-06-04T10:00:00Z"));
    expect(a).toEqual({ away: true, windowKey: "closed" });
    expect(b).toEqual(a);
  });
});

describe("timezone helpers", () => {
  it("validates timezones", () => {
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(5)).toBe(false);
  });
  it("zonedToUtc round-trips through localParts", () => {
    const utc = zonedToUtc(2026, 7, 15, 9 * 60 + 30, "Europe/London"); // BST = UTC+1
    expect(new Date(utc).toISOString()).toBe("2026-07-15T08:30:00.000Z");
    const p = localParts(new Date(utc), "Europe/London");
    expect(p).toMatchObject({ year: 2026, month: 7, day: 15, minute: 570 });
  });
});

describe("validateAwayInput", () => {
  it("accepts a valid schedule", () => {
    const v = validateAwayInput({ enabled: true, message: "  Away!  ", mode: "outside_hours", timezone: "Asia/Tokyo", openDays: 62, openMinute: 540, closeMinute: 1020 });
    expect(v).toEqual({ ok: true, value: { enabled: true, message: "Away!", mode: "outside_hours", timezone: "Asia/Tokyo", openDays: 62, openMinute: 540, closeMinute: 1020 } });
  });
  it("requires a message when enabling", () => {
    expect(validateAwayInput({ enabled: true, message: "  " }).ok).toBe(false);
    expect(validateAwayInput({ enabled: false, message: "" }).ok).toBe(true);
  });
  it("rejects bad mode, timezone, mask, minutes and long messages", () => {
    expect(validateAwayInput({ mode: "sometimes" }).ok).toBe(false);
    expect(validateAwayInput({ timezone: "Nope/Nope" }).ok).toBe(false);
    expect(validateAwayInput({ openDays: 128 }).ok).toBe(false);
    expect(validateAwayInput({ openDays: -1 }).ok).toBe(false);
    expect(validateAwayInput({ openMinute: 1440 }).ok).toBe(false);
    expect(validateAwayInput({ closeMinute: 1.5 }).ok).toBe(false);
    expect(validateAwayInput({ message: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("shouldConsiderAutoReply", () => {
  const ok = { senderIsAutomated: false, senderId: "buyer", sellerId: "seller", conversationIsRequest: false, isAgentSender: false };
  it("allows a normal buyer message", () => expect(shouldConsiderAutoReply(ok)).toBe(true));
  it("never replies to an automated message", () => expect(shouldConsiderAutoReply({ ...ok, senderIsAutomated: true })).toBe(false));
  it("never replies to the seller's own message", () => expect(shouldConsiderAutoReply({ ...ok, senderId: "seller" })).toBe(false));
  it("never replies to the agent", () => expect(shouldConsiderAutoReply({ ...ok, isAgentSender: true })).toBe(false));
  it("never replies inside a pending request", () => expect(shouldConsiderAutoReply({ ...ok, conversationIsRequest: true })).toBe(false));
});
