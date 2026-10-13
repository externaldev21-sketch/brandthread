import { describe, expect, it, vi } from "vitest";

vi.mock("../../shippo", () => ({
  createShipment: vi.fn(), findTransaction: vi.fn(), purchaseTransaction: vi.fn(), refundTransaction: vi.fn(),
}));

import { amountToCents, easyPostRetailCents, fromEasyPostRate, mergeRates, prettyService, type QuotedRate } from "../labelProviders";

function shippo(id: string, carrier: string, service: string, amount: string): QuotedRate {
  return {
    object_id: id, amount, currency: "USD", provider: carrier, servicelevel: { name: service },
    label_provider: "shippo", shipment_id: "shp_s", retail_price_cents: null,
  };
}

describe("labelProviders", () => {
  it("parses provider amounts to cents", () => {
    expect(amountToCents("7.5")).toBe(750);
    expect(amountToCents("12")).toBe(1200);
    expect(amountToCents("0.99")).toBe(99);
    expect(amountToCents("abc")).toBeNull();
    expect(amountToCents(null)).toBeNull();
  });

  it("names EasyPost services like Shippo does", () => {
    expect(prettyService("GroundAdvantage")).toBe("Ground Advantage");
    expect(prettyService("2ndDayAir")).toBe("2nd Day Air");
    expect(prettyService("FEDEX_GROUND", "FedEx")).toBe("Ground");
    expect(prettyService("SMART_POST", "FedEx")).toBe("Smart Post");
    expect(prettyService("Priority Mail")).toBe("Priority Mail");
    expect(prettyService("")).toBe("Shipping");
  });

  it("uses only a retail price EasyPost published above our price", () => {
    expect(easyPostRetailCents({ rate: "6.95", retail_rate: "9.40", list_rate: "8.90" })).toBe(940);
    expect(easyPostRetailCents({ rate: "6.95", retail_rate: null, list_rate: "8.90" })).toBe(890);
    expect(easyPostRetailCents({ rate: "6.95", retail_rate: "6.95", list_rate: null })).toBeNull();
    expect(easyPostRetailCents({ rate: "6.95", retail_rate: null, list_rate: null })).toBeNull();
  });

  it("merges cheapest first, one row per carrier service", () => {
    const ep = fromEasyPostRate({ id: "ep1", carrier: "USPS", service: "GroundAdvantage", rate: "6.95", retail_rate: "9.40" }, "shp_e");
    const merged = mergeRates([
      [shippo("s1", "USPS", "Ground Advantage", "8.10"), shippo("s2", "UPS", "Ground", "12.00")],
      [ep],
    ]);
    expect(merged.map((r) => r.object_id)).toEqual(["ep1", "s2"]);
    expect(merged[0]).toMatchObject({ label_provider: "easypost", shipment_id: "shp_e", retail_price_cents: 940 });
  });

  it("keeps the Shippo rate when it is cheaper, with no invented retail price", () => {
    const ep = fromEasyPostRate({ id: "ep1", carrier: "USPS", service: "GroundAdvantage", rate: "9.00", retail_rate: "9.40" }, "shp_e");
    const merged = mergeRates([[shippo("s1", "USPS", "Ground Advantage", "8.10")], [ep]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ object_id: "s1", label_provider: "shippo", retail_price_cents: null });
  });

  it("drops rates with unusable amounts", () => {
    expect(mergeRates([[shippo("s1", "USPS", "Ground", "free"), shippo("s2", "USPS", "Priority", "0")]])).toEqual([]);
  });
});
