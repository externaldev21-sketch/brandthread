import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, users: {}, shippingRates: {}, shippingZones: {} }));

import { summarizeSellerShipping, toPublicSellerPolicies } from "./publicProductTrust";
import { PRIVATE_PROFILE_KEYS } from "./publicProfile";
import type { ShippingZoneRow } from "./shippingZones";

function zone(over: Partial<ShippingZoneRow>): ShippingZoneRow {
  return {
    id: "z1", name: "Domestic", zoneType: "domestic", countries: [], pricingModel: "flat",
    flatRateCents: 595, freeAboveCents: 7500, processingDays: 3, carrierLabel: null,
    shipsInternationally: true, dutiesHandling: "dap", active: true, sortOrder: 0, ...over,
  };
}

describe("toPublicSellerPolicies", () => {
  it("returns the seller's own text, trimmed", () => {
    expect(toPublicSellerPolicies({ returnPolicy: "  Returns within 30 days. ", cancellationPolicy: "Cancel before it ships." }))
      .toEqual({ sellerReturnPolicy: "Returns within 30 days.", sellerCancellationPolicy: "Cancel before it ships." });
  });

  it("maps empty or missing policies to null (no invented terms)", () => {
    expect(toPublicSellerPolicies({ returnPolicy: "   ", cancellationPolicy: null }))
      .toEqual({ sellerReturnPolicy: null, sellerCancellationPolicy: null });
    expect(toPublicSellerPolicies(undefined)).toEqual({ sellerReturnPolicy: null, sellerCancellationPolicy: null });
  });

  it("uses keys that the public-profile privacy guard does not block", () => {
    const keys = Object.keys(toPublicSellerPolicies({ returnPolicy: "x", cancellationPolicy: "y" }));
    expect(keys.filter((k) => (PRIVATE_PROFILE_KEYS as readonly string[]).includes(k))).toEqual([]);
  });
});

describe("summarizeSellerShipping", () => {
  it("prefers the domestic shipping zone, like checkout", () => {
    expect(summarizeSellerShipping({
      zones: [zone({ id: "row", zoneType: "rest_of_world", flatRateCents: 2500, freeAboveCents: null, sortOrder: 0 }), zone({ sortOrder: 1 })],
      legacyRate: { flatRateCents: 999, freeAboveCents: null, active: true },
      sellerHomeCountry: "US",
    })).toEqual({ rateCents: 595, freeAboveCents: 7500, processingDays: 3 });
  });

  it("falls back to rest-of-world when there is no domestic zone", () => {
    expect(summarizeSellerShipping({
      zones: [zone({ id: "row", zoneType: "rest_of_world", flatRateCents: 1200, freeAboveCents: null, processingDays: 5 })],
      legacyRate: null,
      sellerHomeCountry: "US",
    })).toEqual({ rateCents: 1200, freeAboveCents: null, processingDays: 5 });
  });

  it("does not quote a price for weight-tiered zones", () => {
    expect(summarizeSellerShipping({
      zones: [zone({ pricingModel: "weight_tiered", freeAboveCents: null })],
      legacyRate: null,
      sellerHomeCountry: "US",
    })).toEqual({ rateCents: null, freeAboveCents: null, processingDays: 3 });
  });

  it("uses the legacy flat rate when the seller has no zones", () => {
    expect(summarizeSellerShipping({
      zones: [],
      legacyRate: { flatRateCents: 800, freeAboveCents: 5000, active: true },
      sellerHomeCountry: "US",
    })).toEqual({ rateCents: 800, freeAboveCents: 5000, processingDays: null });
  });

  it("returns null when the seller configured nothing", () => {
    expect(summarizeSellerShipping({ zones: [], legacyRate: null, sellerHomeCountry: "US" })).toBeNull();
    expect(summarizeSellerShipping({ zones: [zone({ active: false })], legacyRate: { flatRateCents: 1, freeAboveCents: null, active: false }, sellerHomeCountry: "US" })).toBeNull();
  });

  it("returns null when no zone ships domestically", () => {
    expect(summarizeSellerShipping({
      zones: [zone({ zoneType: "country", countries: ["CA"] })],
      legacyRate: null,
      sellerHomeCountry: "US",
    })).toBeNull();
  });
});
