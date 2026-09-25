import { describe, it, expect } from "vitest";
import { resolveShippingForDestination, type ShippingZoneRow, type ShippingZoneWeightTierRow } from "../shippingZones";

function zone(overrides: Partial<ShippingZoneRow> = {}): ShippingZoneRow {
  return {
    id: "zone-1",
    name: "Zone",
    zoneType: "domestic",
    countries: [],
    pricingModel: "flat",
    flatRateCents: 500,
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

describe("resolveShippingForDestination", () => {
  it("matches the domestic zone for the seller's home country", () => {
    const zones = [zone({ id: "dom", zoneType: "domestic", flatRateCents: 500 })];
    const result = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 0,
    });
    expect(result.zoneId).toBe("dom");
    expect(result.shippingCents).toBe(500);
    expect(result.unavailable).toBe(false);
  });

  it("matches a named country zone over the rest-of-world catch-all", () => {
    const zones = [
      zone({ id: "dom", zoneType: "domestic", flatRateCents: 500 }),
      zone({ id: "ca", zoneType: "country", countries: ["CA"], flatRateCents: 1200 }),
      zone({ id: "row", zoneType: "rest_of_world", flatRateCents: 2500 }),
    ];
    const result = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "CA", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 0,
    });
    expect(result.zoneId).toBe("ca");
    expect(result.shippingCents).toBe(1200);
  });

  it("falls back to rest-of-world when no specific zone covers the destination", () => {
    const zones = [
      zone({ id: "dom", zoneType: "domestic", flatRateCents: 500 }),
      zone({ id: "row", zoneType: "rest_of_world", flatRateCents: 2500 }),
    ];
    const result = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "FR", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 0,
    });
    expect(result.zoneId).toBe("row");
    expect(result.shippingCents).toBe(2500);
  });

  it("is unavailable when a country zone opts out of international shipping and no catch-all exists", () => {
    const zones = [zone({ id: "dom", zoneType: "domestic", flatRateCents: 500 })];
    const result = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "FR", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 0,
    });
    expect(result.unavailable).toBe(true);
    expect(result.shippingCents).toBe(0);
  });

  it("skips a rest-of-world zone marked not shipping internationally", () => {
    const zones = [zone({ id: "row", zoneType: "rest_of_world", flatRateCents: 2500, shipsInternationally: false })];
    const result = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "FR", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 0,
    });
    expect(result.unavailable).toBe(true);
  });

  it("applies the free-shipping threshold", () => {
    const zones = [zone({ id: "dom", zoneType: "domestic", flatRateCents: 500, freeAboveCents: 5000 })];
    const under = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 4999, weightGrams: 0,
    });
    expect(under.shippingCents).toBe(500);
    expect(under.isFree).toBe(false);
    const over = resolveShippingForDestination({
      zones, weightTiers: [], destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 5000, weightGrams: 0,
    });
    expect(over.shippingCents).toBe(0);
    expect(over.isFree).toBe(true);
  });

  it("resolves weight-tiered pricing by matching the cart weight bracket", () => {
    const zones = [zone({ id: "dom", zoneType: "domestic", pricingModel: "weight_tiered" })];
    const weightTiers: ShippingZoneWeightTierRow[] = [
      { zoneId: "dom", minWeightGrams: 0, maxWeightGrams: 500, rateCents: 400, sortOrder: 0 },
      { zoneId: "dom", minWeightGrams: 501, maxWeightGrams: 2000, rateCents: 800, sortOrder: 1 },
      { zoneId: "dom", minWeightGrams: 2001, maxWeightGrams: null, rateCents: 1500, sortOrder: 2 },
    ];
    const light = resolveShippingForDestination({
      zones, weightTiers, destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 300,
    });
    expect(light.shippingCents).toBe(400);
    const mid = resolveShippingForDestination({
      zones, weightTiers, destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 1000,
    });
    expect(mid.shippingCents).toBe(800);
    const heavy = resolveShippingForDestination({
      zones, weightTiers, destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 5000,
    });
    expect(heavy.shippingCents).toBe(1500);
  });

  it("falls back to the top weight tier when the cart exceeds every configured bracket", () => {
    const zones = [zone({ id: "dom", zoneType: "domestic", pricingModel: "weight_tiered", flatRateCents: 999 })];
    const weightTiers: ShippingZoneWeightTierRow[] = [
      { zoneId: "dom", minWeightGrams: 0, maxWeightGrams: 500, rateCents: 400, sortOrder: 0 },
    ];
    const result = resolveShippingForDestination({
      zones, weightTiers, destinationCountry: "US", sellerHomeCountry: "US",
      subtotalCents: 1000, weightGrams: 100000,
    });
    expect(result.shippingCents).toBe(400);
  });
});
