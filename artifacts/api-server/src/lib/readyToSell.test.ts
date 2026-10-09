import { describe, expect, it } from "vitest";
import { deriveReadyToSell } from "./readyToSell";

const fresh = {
  productCount: 0, brandName: null, hasShippingRates: false, stripeAccountStatus: null,
  logoUrl: null, storeAccentColor: null, storefrontSaved: false, storeShared: false, orderCount: 0,
};

describe("deriveReadyToSell", () => {
  it("starts at 0 / 6 in Dev's order", () => {
    const r = deriveReadyToSell(fresh);
    expect(r.steps.map((s) => s.id)).toEqual([
      "first_product", "name_store", "shipping_rates", "payouts", "customize_store", "share_store",
    ]);
    expect(r).toMatchObject({ doneCount: 0, total: 6, complete: false, hasSale: false });
  });

  it("ticks each step from real state", () => {
    const r = deriveReadyToSell({
      ...fresh, productCount: 2, brandName: "Northline", hasShippingRates: true,
      stripeAccountStatus: "active", storeAccentColor: "#C0C0C0", storeShared: true,
    });
    expect(r.steps.every((s) => s.done)).toBe(true);
    expect(r.complete).toBe(true);
  });

  it("does not count blank names, pending payouts, or zero products", () => {
    const r = deriveReadyToSell({ ...fresh, brandName: "  ", stripeAccountStatus: "pending" });
    expect(r.doneCount).toBe(0);
  });

  it("counts a saved storefront or a logo as customized and reports the first sale", () => {
    expect(deriveReadyToSell({ ...fresh, storefrontSaved: true }).steps[4].done).toBe(true);
    expect(deriveReadyToSell({ ...fresh, logoUrl: "https://x/logo.png" }).steps[4].done).toBe(true);
    expect(deriveReadyToSell({ ...fresh, orderCount: 1 }).hasSale).toBe(true);
  });
});
