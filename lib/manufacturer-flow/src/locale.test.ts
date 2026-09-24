import { describe, expect, it } from "vitest";
import { findCountry, formatMoney, formatTimestamp, hoursAhead, isValidTimeZone, localTimeLabel, timeZoneOffsetLabel } from "./locale";
import { carrierDisplayName, trackingUrl } from "./shipping";

describe("formatMoney", () => {
  it("labels US dollars explicitly for international readers", () => {
    expect(formatMoney(125050)).toBe("US$1,250.50");
    expect(formatMoney(0)).toBe("US$0.00");
  });
  it("respects zero-decimal currencies", () => {
    expect(formatMoney(250000, "VND")).toContain("250,000");
    expect(formatMoney(1999, "EUR")).toBe("€19.99");
  });
});

describe("countries and time zones", () => {
  it("resolves countries by name or ISO code", () => {
    expect(findCountry("Vietnam")).toMatchObject({ code: "VN", currency: "VND", timeZone: "Asia/Ho_Chi_Minh" });
    expect(findCountry("bd")?.name).toBe("Bangladesh");
    expect(findCountry("Atlantis")).toBeNull();
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone("Asia/Dhaka")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("describes offsets and local time", () => {
    const at = new Date("2026-09-22T08:00:00Z");
    expect(timeZoneOffsetLabel("Asia/Ho_Chi_Minh", at)).toBe("GMT+7");
    expect(timeZoneOffsetLabel("Asia/Kolkata", at)).toBe("GMT+5:30");
    expect(localTimeLabel("Asia/Ho_Chi_Minh", at)).toBe("3:00 PM local time (GMT+7)");
    expect(localTimeLabel("nope", at)).toBeNull();
  });

  it("computes the gap between seller and manufacturer", () => {
    const at = new Date("2026-09-22T08:00:00Z");
    expect(hoursAhead("America/New_York", "Asia/Ho_Chi_Minh", at)).toBe(11);
    expect(hoursAhead("Asia/Kolkata", "Europe/London", at)).toBe(-4.5);
  });

  it("formats tracker timestamps with an explicit offset", () => {
    expect(formatTimestamp("2026-09-22T08:00:00Z", { timeZone: "Asia/Dhaka" })).toBe("Sep 22, 2:00 PM GMT+6");
    expect(formatTimestamp("not a date")).toBe("");
  });
});

describe("tracking links", () => {
  it("links known carriers and falls back to a universal tracker", () => {
    expect(trackingUrl("DHL Express", "12345")).toContain("dhl.com");
    expect(trackingUrl("ups", "1Z 999")).toBe("https://www.ups.com/track?tracknum=1Z%20999");
    expect(trackingUrl("Some Local Courier", "AB1")).toBe("https://t.17track.net/en#nums=AB1");
    expect(trackingUrl("DHL Express", "")).toBeNull();
    expect(carrierDisplayName("fedex")).toBe("FedEx");
    expect(carrierDisplayName("Local Courier")).toBe("Local Courier");
  });
});
