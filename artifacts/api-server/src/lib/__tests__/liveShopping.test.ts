import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_GIFT_FEE_BPS, FLASH_DEAL_MINUTES, flashDealExpiry, liveGiftFeeBps, publicBuyerName,
  purchaseText, splitLiveGift,
} from "../liveShopping";
import { giftText } from "../liveShopping";

describe("flashDealExpiry", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  it("offers 5, 10 and 15 minute deals", () => {
    expect([...FLASH_DEAL_MINUTES]).toEqual([5, 10, 15]);
  });
  it("sets the expiry from the server clock", () => {
    expect(flashDealExpiry(10, now)?.toISOString()).toBe("2026-10-13T12:10:00.000Z");
    expect(flashDealExpiry("5", now)?.toISOString()).toBe("2026-10-13T12:05:00.000Z");
  });
  it("is null when no duration was asked for", () => {
    expect(flashDealExpiry(undefined, now)).toBeNull();
    expect(flashDealExpiry(null, now)).toBeNull();
  });
  it("rejects any other duration", () => {
    expect(() => flashDealExpiry(7, now)).toThrow(RangeError);
    expect(() => flashDealExpiry(0, now)).toThrow(RangeError);
    expect(() => flashDealExpiry(-5, now)).toThrow(RangeError);
    expect(() => flashDealExpiry(600, now)).toThrow(RangeError);
  });
});

describe("live gift platform fee", () => {
  it("defaults to 30% and clamps to 0..90%", () => {
    expect(liveGiftFeeBps(undefined)).toBe(DEFAULT_LIVE_GIFT_FEE_BPS);
    expect(liveGiftFeeBps("")).toBe(3000);
    expect(liveGiftFeeBps("nope")).toBe(3000);
    expect(liveGiftFeeBps("1500")).toBe(1500);
    expect(liveGiftFeeBps("-20")).toBe(0);
    expect(liveGiftFeeBps("9500")).toBe(9000);
    expect(liveGiftFeeBps("0")).toBe(0);
  });
  it("rounds the fee down so fee + net always equals the gift", () => {
    expect(splitLiveGift(1000, 3000)).toEqual({ feeCents: 300, netCents: 700 });
    expect(splitLiveGift(999, 3000)).toEqual({ feeCents: 299, netCents: 700 });
    expect(splitLiveGift(1, 3000)).toEqual({ feeCents: 0, netCents: 1 });
    expect(splitLiveGift(500, 0)).toEqual({ feeCents: 0, netCents: 500 });
    expect(splitLiveGift(500, 9000)).toEqual({ feeCents: 450, netCents: 50 });
    expect(splitLiveGift(500, 20000)).toEqual({ feeCents: 450, netCents: 50 });
    for (let gross = 1; gross <= 2500; gross += 37) {
      const { feeCents, netCents } = splitLiveGift(gross, 3000);
      expect(feeCents + netCents).toBe(gross);
      expect(netCents).toBeGreaterThan(0);
    }
  });
  it("rejects fractional or negative cents", () => {
    expect(() => splitLiveGift(1.5, 3000)).toThrow(RangeError);
    expect(() => splitLiveGift(-1, 3000)).toThrow(RangeError);
  });
});

describe("just-bought ticker privacy", () => {
  it("shows only a first name, else the handle", () => {
    expect(publicBuyerName({ displayName: "Ana María López", username: "ana" })).toBe("Ana");
    expect(publicBuyerName({ displayName: "  ", username: "ana.l" })).toBe("@ana.l");
    expect(publicBuyerName({ displayName: null, username: "@ana" })).toBe("@ana");
    expect(publicBuyerName({ displayName: "ana@example.com", username: null })).toBe("Someone");
    expect(publicBuyerName({})).toBe("Someone");
  });
  it("names the product", () => {
    expect(purchaseText(["Linen Blazer"])).toBe("just bought Linen Blazer");
    expect(purchaseText(["Linen Blazer", "Silk Scarf", "Belt"])).toBe("just bought Linen Blazer and 2 more");
    expect(purchaseText([])).toBe("just bought");
  });
  it("words a gift as sent", () => {
    expect(giftText(500)).toBe("sent $5 Thread Cash");
    expect(giftText(250)).toBe("sent $2.50 Thread Cash");
  });
});
