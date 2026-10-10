import { describe, expect, it } from "vitest";
import { defaultShippingCents, flatRateShipping, STANDARD_SHIPPING_CENTS } from "../defaultShipping";

describe("default shipping", () => {
  it("charges the standard rate when the seller set no rate", () => {
    expect(flatRateShipping(null, 5_000, {})).toEqual({ cents: STANDARD_SHIPPING_CENTS, name: "Standard shipping" });
  });
  it("keeps a seller's own rate, free-over threshold and $0 rate", () => {
    expect(flatRateShipping({ flatRateCents: 800, freeAboveCents: 10_000, name: "USPS" }, 5_000, {})).toEqual({ cents: 800, name: "USPS" });
    expect(flatRateShipping({ flatRateCents: 800, freeAboveCents: 10_000, name: null }, 12_000, {})).toEqual({ cents: 0, name: "Shipping" });
    expect(flatRateShipping({ flatRateCents: 0, freeAboveCents: null, name: "Free shipping" }, 100, {})).toEqual({ cents: 0, name: "Free shipping" });
  });
  it("reads DEFAULT_SHIPPING_CENTS, ignoring bad values", () => {
    expect(defaultShippingCents({ DEFAULT_SHIPPING_CENTS: "450" })).toBe(450);
    expect(defaultShippingCents({ DEFAULT_SHIPPING_CENTS: "0" })).toBe(0);
    expect(defaultShippingCents({ DEFAULT_SHIPPING_CENTS: "abc" })).toBe(STANDARD_SHIPPING_CENTS);
    expect(defaultShippingCents({ DEFAULT_SHIPPING_CENTS: "-5" })).toBe(STANDARD_SHIPPING_CENTS);
  });
});
