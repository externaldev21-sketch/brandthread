import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), multiRemove: vi.fn(async () => {}), getAllKeys: vi.fn(async () => []) },
}));
vi.mock("@/lib/serviceConfig", () => ({ serviceRequest }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/marketingPixels", () => ({ trackAndRelayConversionEvent: vi.fn(() => false) }));

import { estimateGroupShipping, totalShippingEstimate } from "./cartService";

beforeEach(() => serviceRequest.mockReset());

describe("estimateGroupShipping", () => {
  it("uses the seller's public rate for the group subtotal", async () => {
    serviceRequest.mockResolvedValueOnce({ shippingCents: 795, rateName: "Standard", isFree: false });
    await expect(estimateGroupShipping("seller-1", 4200)).resolves.toEqual({ amountCents: 795, name: "Standard" });
    expect(serviceRequest).toHaveBeenCalledWith("/api/shipping-rates/calculate?sellerId=seller-1&subtotalCents=4200");
  });

  it("returns null instead of $0 when the rate can't be fetched", async () => {
    serviceRequest.mockRejectedValueOnce(new Error("offline"));
    await expect(estimateGroupShipping("seller-1", 4200)).resolves.toBeNull();
  });
});

describe("totalShippingEstimate", () => {
  it("sums every seller group", () => {
    expect(totalShippingEstimate(["a", "b"], { a: { amountCents: 500, name: "x" }, b: { amountCents: 0, name: "Free shipping" } })).toBe(500);
  });
  it("is unknown while any group is missing", () => {
    expect(totalShippingEstimate(["a", "b"], { a: { amountCents: 500, name: "x" }, b: null })).toBeNull();
    expect(totalShippingEstimate(["a"], {})).toBeNull();
  });
});
