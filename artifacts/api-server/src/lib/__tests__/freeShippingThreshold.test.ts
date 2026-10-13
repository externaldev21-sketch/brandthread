import { describe, it, expect } from "vitest";
import { resolveFreeShippingThreshold } from "../freeShippingThreshold";
import type { ShippingZoneRow } from "../shippingZones";

function zone(overrides: Partial<ShippingZoneRow> = {}): ShippingZoneRow {
  return {
    id: "zone-1",
    name: "Zone",
    zoneType: "domestic",
    countries: [],
    pricingModel: "flat",
    flatRateCents: 800,
    freeAboveCents: null,
    processingDays: 2,
    carrierLabel: null,
    shipsInternationally: true,
    dutiesHandling: "dap",
    active: true,
    sortOrder: 0,
    ...overrides,
  };
}

const rate = (overrides: Partial<{ flatRateCents: number; freeAboveCents: number | null; active: boolean }> = {}) => ({
  flatRateCents: 600, freeAboveCents: 5000, active: true, ...overrides,
});

describe("resolveFreeShippingThreshold", () => {
  it("uses the domestic zone's threshold", () => {
    const zones = [
      zone({ id: "row", zoneType: "rest_of_world", freeAboveCents: 20000, sortOrder: 0 }),
      zone({ id: "dom", zoneType: "domestic", freeAboveCents: 7500, sortOrder: 1 }),
    ];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: null, sellerHomeCountry: "US" })).toBe(7500);
  });

  it("prefers zones over the legacy rate, like checkout pricing", () => {
    const zones = [zone({ freeAboveCents: null })];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: rate(), sellerHomeCountry: "US" })).toBeNull();
  });

  it("falls back to rest_of_world when there is no domestic zone", () => {
    const zones = [zone({ id: "row", zoneType: "rest_of_world", freeAboveCents: 9900 })];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: null, sellerHomeCountry: "GB" })).toBe(9900);
  });

  it("matches a domestic zone listing explicit countries against the seller's home country", () => {
    const zones = [
      zone({ id: "dom", zoneType: "domestic", countries: ["CA"], freeAboveCents: 4000 }),
      zone({ id: "row", zoneType: "rest_of_world", freeAboveCents: 15000 }),
    ];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: null, sellerHomeCountry: "CA" })).toBe(4000);
  });

  it("ignores inactive zones and uses the legacy rate when none are active", () => {
    const zones = [zone({ active: false, freeAboveCents: 3000 })];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: rate({ freeAboveCents: 6000 }), sellerHomeCountry: "US" })).toBe(6000);
  });

  it("returns null when no zone covers the seller's own country", () => {
    const zones = [zone({ zoneType: "country", countries: ["FR"], freeAboveCents: 3000 })];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: null, sellerHomeCountry: "US" })).toBeNull();
  });

  it("returns null when shipping is already free (a $0 flat rate)", () => {
    expect(resolveFreeShippingThreshold({ zones: [zone({ flatRateCents: 0, freeAboveCents: 5000 })], legacyRate: null, sellerHomeCountry: "US" })).toBeNull();
    expect(resolveFreeShippingThreshold({ zones: [], legacyRate: rate({ flatRateCents: 0 }), sellerHomeCountry: "US" })).toBeNull();
  });

  it("keeps the threshold for a weight-tiered zone", () => {
    const zones = [zone({ pricingModel: "weight_tiered", flatRateCents: 0, freeAboveCents: 12000 })];
    expect(resolveFreeShippingThreshold({ zones, legacyRate: null, sellerHomeCountry: "US" })).toBe(12000);
  });

  it("returns null for a zero, missing or inactive legacy threshold", () => {
    expect(resolveFreeShippingThreshold({ zones: [], legacyRate: rate({ freeAboveCents: 0 }), sellerHomeCountry: "US" })).toBeNull();
    expect(resolveFreeShippingThreshold({ zones: [], legacyRate: rate({ freeAboveCents: null }), sellerHomeCountry: "US" })).toBeNull();
    expect(resolveFreeShippingThreshold({ zones: [], legacyRate: rate({ active: false }), sellerHomeCountry: "US" })).toBeNull();
    expect(resolveFreeShippingThreshold({ zones: [], legacyRate: null, sellerHomeCountry: "US" })).toBeNull();
  });

  it("uses the legacy rate's threshold when the seller has no zones", () => {
    expect(resolveFreeShippingThreshold({ zones: [], legacyRate: rate(), sellerHomeCountry: "US" })).toBe(5000);
  });
});
