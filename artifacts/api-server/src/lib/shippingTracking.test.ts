import { describe, expect, it } from "vitest";
import { orderStatusMachine } from "./money/stateMachines";
import { carrierKeyOf, normalizeTrackingNumber, sellerMayMarkDelivered, validateTrackingNumber } from "./shippingTracking";

describe("validateTrackingNumber", () => {
  it.each([
    ["USPS", "9400 1118 9922 3344 5566 77", "9400111899223344556677"],
    ["USPS", "ea123456789us", "EA123456789US"],
    ["UPS", "1z999aa10123456784", "1Z999AA10123456784"],
    ["FedEx", "1234-5678-9012", "123456789012"],
    ["DHL Express", "1234567890", "1234567890"],
    ["OnTrac", "C11234567890123", "C11234567890123"],
  ])("accepts a %s number and normalizes it", (carrier, raw, stored) => {
    expect(validateTrackingNumber(carrier, raw)).toEqual({ ok: true, carrier, trackingNumber: stored });
  });

  it("stores the picker label for a known carrier, whatever the casing", () => {
    expect(validateTrackingNumber("ups", "1Z999AA10123456784")).toMatchObject({ ok: true, carrier: "UPS" });
    expect(validateTrackingNumber("dhl", "1234567890")).toMatchObject({ ok: true, carrier: "DHL Express" });
  });

  it.each([
    ["UPS", "1ZROUTE"],
    ["UPS", "9400111899223344556677"],
    ["USPS", "1Z999AA10123456784"],
    ["FedEx", "12345"],
    ["DHL Express", "ABC"],
    ["OnTrac", "abc!"],
  ])("rejects a %s number in the wrong format (%s)", (carrier, raw) => {
    const result = validateTrackingNumber(carrier, raw);
    expect(result).toMatchObject({ ok: false, field: "trackingNumber" });
  });

  it("requires a carrier name and a number", () => {
    expect(validateTrackingNumber("", "1Z999AA10123456784")).toMatchObject({ ok: false, field: "carrier" });
    expect(validateTrackingNumber("Other", "1Z999AA10123456784")).toMatchObject({ ok: false, field: "carrier" });
    expect(validateTrackingNumber("UPS", "   ")).toMatchObject({ ok: false, field: "trackingNumber" });
    expect(validateTrackingNumber("UPS", 42)).toMatchObject({ ok: false, field: "trackingNumber" });
  });

  it("maps carrier names onto picker keys", () => {
    expect(carrierKeyOf("Fed Ex")).toBe("fedex");
    expect(carrierKeyOf("Royal Mail")).toBe("other");
    expect(normalizeTrackingNumber(" 1z 99-9 ")).toBe("1Z999");
  });
});

describe("sellerMayMarkDelivered", () => {
  const shipped = { status: "shipped", deliveredAt: null, autoRefundedAt: null, carrier: "Local courier", trackingNumber: "LC123456" };

  it("allows a shipped order whose carrier can't report delivery", () => {
    expect(sellerMayMarkDelivered(shipped)).toEqual({ ok: true });
    expect(sellerMayMarkDelivered({ ...shipped, carrier: null, trackingNumber: null })).toEqual({ ok: true });
  });

  it("leaves delivery to the carrier when it can scan it", () => {
    expect(sellerMayMarkDelivered({ ...shipped, carrier: "UPS", trackingNumber: "1Z999AA10123456784" }))
      .toMatchObject({ ok: false, code: "CARRIER_TRACKED" });
  });

  it("checks every undelivered parcel, not just the order's own number", () => {
    const items = [
      { carrier: "USPS", trackingNumber: "9400111899223344556677", deliveredAt: null, refundedAt: null },
    ];
    expect(sellerMayMarkDelivered(shipped, items)).toMatchObject({ ok: false, code: "CARRIER_TRACKED" });
    // Already delivered or refunded parcels don't count.
    expect(sellerMayMarkDelivered(shipped, [{ ...items[0], deliveredAt: new Date() }])).toEqual({ ok: true });
    expect(sellerMayMarkDelivered(shipped, [{ ...items[0], refundedAt: new Date() }])).toEqual({ ok: true });
  });

  it("refuses orders that haven't shipped, are delivered, or were auto-refunded", () => {
    for (const status of ["pending", "processing", "fulfilled", "cancelled", "refund_pending", "delivered"]) {
      expect(sellerMayMarkDelivered({ ...shipped, status })).toMatchObject({ ok: false, code: "NOT_SHIPPED" });
    }
    expect(sellerMayMarkDelivered({ ...shipped, autoRefundedAt: new Date() })).toMatchObject({ ok: false, code: "AUTO_REFUNDED" });
  });
});

describe("order event transitions (orderStatusMachine)", () => {
  it("Ordered → Shipped from every pre-shipment state the seller form allows", () => {
    for (const from of ["pending", "processing", "fulfilled"] as const) {
      expect(orderStatusMachine.can(from, "shipped")).toBe(true);
    }
  });

  it("Shipped → Delivered, and nothing skips Shipped", () => {
    expect(orderStatusMachine.can("shipped", "delivered")).toBe(true);
    expect(orderStatusMachine.sourcesOf("delivered")).toEqual(["shipped"]);
  });

  it("never ships a cancelled, refunding or delivered order", () => {
    for (const from of ["cancelled", "refund_pending", "delivered"] as const) {
      expect(orderStatusMachine.can(from, "shipped")).toBe(false);
    }
  });
});
