import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveShippingForDestination, type ShippingZoneRow } from "../../shippingZones";
import {
  DEFAULT_PARCEL_IN, cheapestUsdRate, liveRateCacheKey, liveRatesEnabled, resetLiveRateCacheForTests,
  withLiveCarrierRate, type LiveRateQuoter,
} from "../liveShippingRates";

const ON = { SHIPPO_LIVE_RATES_ENABLED: "true", REPLIT_CONNECTORS_HOSTNAME: "connectors.example", REPL_IDENTITY: "id" };

function zone(over: Partial<ShippingZoneRow> = {}): ShippingZoneRow {
  return {
    id: "z-intl", name: "International", zoneType: "rest_of_world", countries: [], pricingModel: "calculated",
    flatRateCents: 2_500, freeAboveCents: null, processingDays: 3, carrierLabel: null, shipsInternationally: true,
    dutiesHandling: "dap", active: true, sortOrder: 1, ...over,
  };
}

function resolve(zones: ShippingZoneRow[], subtotalCents = 5_000) {
  return resolveShippingForDestination({ zones, weightTiers: [], destinationCountry: "GB", sellerHomeCountry: "US", subtotalCents, weightGrams: 900 });
}

const ctx = (zones: ShippingZoneRow[], over: Record<string, unknown> = {}) => ({
  sellerId: "seller_1", zones, shipFrom: { country: "US", postalCode: "10001" },
  destination: { country: "GB", postalCode: "SW1W 0NY" }, weightGrams: 900, subtotalCents: 5_000, ...over,
});

beforeEach(() => resetLiveRateCacheForTests());

describe("live carrier rates for calculated zones", () => {
  it("prices a calculated zone from its flat rate in the pure resolver (the fallback)", () => {
    expect(resolve([zone()]).shippingCents).toBe(2_500);
  });

  it("flag off: returns the resolver's result untouched and never calls the carrier", async () => {
    const quoter = vi.fn<LiveRateQuoter>();
    const resolved = resolve([zone()]);
    const out = await withLiveCarrierRate(resolved, { ...ctx([zone()]), env: {}, quoter });
    expect(out).toBe(resolved);
    expect(quoter).not.toHaveBeenCalled();
    // Flag on but no connector configured counts as off.
    expect(liveRatesEnabled({ SHIPPO_LIVE_RATES_ENABLED: "true" })).toBe(false);
  });

  it("flag on: charges the cheapest live quote and caches it for 30 minutes per bucket", async () => {
    const quoter = vi.fn<LiveRateQuoter>(async () => ({ amountCents: 3_190, carrier: "USPS", service: "Priority Mail International", estimatedDays: 7 }));
    let now = 1_000_000;
    const first = await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()]), env: ON, quoter, now: () => now });
    expect(first).toMatchObject({ shippingCents: 3_190, isFree: false, rateSource: "live", carrierLabel: "USPS Priority Mail International" });
    expect(quoter.mock.calls[0][0]).toMatchObject({ from: { country: "US", postalCode: "10001" }, to: { country: "GB", postalCode: "SW1W 0NY" }, weightGrams: 1_000, parcelIn: DEFAULT_PARCEL_IN });
    // Same bucket (751–1000 g), same postcode → cached.
    await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()], { weightGrams: 980 }), env: ON, quoter, now: () => now });
    expect(quoter).toHaveBeenCalledTimes(1);
    now += 30 * 60 * 1000;
    await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()]), env: ON, quoter, now: () => now });
    expect(quoter).toHaveBeenCalledTimes(2);
    expect(liveRateCacheKey("s", "gb", "sw1w 0ny", 900)).toBe("s|GB|SW1W0NY|1000");
  });

  it("falls back to the flat rate when the carrier fails, the seller has no postcode, or weight is unknown", async () => {
    const failing = vi.fn<LiveRateQuoter>(async () => { throw new Error("Shippo 500"); });
    expect(await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()]), env: ON, quoter: failing }))
      .toMatchObject({ shippingCents: 2_500, rateSource: "fallback" });
    const quoter = vi.fn<LiveRateQuoter>(async () => ({ amountCents: 999, carrier: "UPS", service: "Worldwide", estimatedDays: null }));
    expect(await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()], { shipFrom: { country: "US", postalCode: null } }), env: ON, quoter }))
      .toMatchObject({ shippingCents: 2_500, rateSource: "fallback" });
    expect(await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()], { weightGrams: 0 }), env: ON, quoter }))
      .toMatchObject({ shippingCents: 2_500, rateSource: "fallback" });
    const empty = vi.fn<LiveRateQuoter>(async () => null);
    expect(await withLiveCarrierRate(resolve([zone()]), { ...ctx([zone()]), env: ON, quoter: empty }))
      .toMatchObject({ shippingCents: 2_500, rateSource: "fallback" });
    expect(quoter).not.toHaveBeenCalled();
  });

  it("leaves flat / weight-tiered zones and the free-shipping threshold alone", async () => {
    const quoter = vi.fn<LiveRateQuoter>(async () => ({ amountCents: 999, carrier: "UPS", service: "x", estimatedDays: null }));
    const flat = zone({ pricingModel: "flat" });
    const r1 = resolve([flat]);
    expect(await withLiveCarrierRate(r1, { ...ctx([flat]), env: ON, quoter })).toBe(r1);
    const free = zone({ freeAboveCents: 4_000 });
    const r2 = resolve([free]);
    expect(await withLiveCarrierRate(r2, { ...ctx([free]), env: ON, quoter })).toBe(r2);
    expect(quoter).not.toHaveBeenCalled();
  });

  it("picks the cheapest USD rate from a Shippo shipment", () => {
    expect(cheapestUsdRate([
      { amount: "41.20", currency: "USD", provider: "DHL Express", servicelevel: { name: "Express Worldwide" } },
      { amount: "28.05", currency: "USD", provider: "USPS", servicelevel: { name: "Priority Mail International" }, estimated_days: 8 },
      { amount: "10.00", currency: "EUR", provider: "Other" },
    ])).toEqual({ amountCents: 2_805, carrier: "USPS", service: "Priority Mail International", estimatedDays: 8 });
    expect(cheapestUsdRate([])).toBeNull();
  });
});
