import { describe, expect, it } from "vitest";
import { resolveWholesalePrice, wholesaleTermsFor, type WholesaleRule, type WholesaleSettings } from "./wholesale";

const on: WholesaleSettings = { enabled: true, minOrderCents: 0, defaultPercentOff: 40 };
const line = (over: Partial<{ productId: string; variantId: string; quantity: number; retailUnitCents: number; currentUnitCents: number }> = {}) => ({
  productId: "p1", variantId: "v1", quantity: 1, retailUnitCents: 5_000, currentUnitCents: 5_000, ...over,
});

describe("wholesaleTermsFor", () => {
  it("uses the default % off retail when no fixed price exists", () => {
    expect(wholesaleTermsFor(on, [], { productId: "p1", variantId: "v1", retailUnitCents: 5_000 })).toEqual({ unitCents: 3_000, minQuantity: 1 });
  });

  it("has no wholesale price when the default is 0% and nothing is fixed", () => {
    expect(wholesaleTermsFor({ defaultPercentOff: 0 }, [], { productId: "p1", variantId: "v1", retailUnitCents: 5_000 }).unitCents).toBeNull();
  });

  it("prefers a variant rule over a product rule, falling back field by field", () => {
    const rules: WholesaleRule[] = [
      { productId: "p1", variantId: null, priceCents: 2_500, minQuantity: 6 },
      { productId: "p1", variantId: "v2", priceCents: 2_000, minQuantity: 12 },
      { productId: "p1", variantId: "v3", priceCents: null, minQuantity: 3 },
    ];
    expect(wholesaleTermsFor(on, rules, { productId: "p1", variantId: "v1", retailUnitCents: 5_000 })).toEqual({ unitCents: 2_500, minQuantity: 6 });
    expect(wholesaleTermsFor(on, rules, { productId: "p1", variantId: "v2", retailUnitCents: 5_000 })).toEqual({ unitCents: 2_000, minQuantity: 12 });
    // v3 only sets a quantity: its price comes from the product rule.
    expect(wholesaleTermsFor(on, rules, { productId: "p1", variantId: "v3", retailUnitCents: 5_000 })).toEqual({ unitCents: 2_500, minQuantity: 3 });
  });

  it("caps the default discount at 90%", () => {
    expect(wholesaleTermsFor({ defaultPercentOff: 150 }, [], { productId: "p1", variantId: null, retailUnitCents: 1_000 }).unitCents).toBe(100);
  });
});

describe("resolveWholesalePrice", () => {
  it("is retail when the price list is off or missing", () => {
    expect(resolveWholesalePrice({ settings: null, approved: true, rules: [], lines: [line()] })).toMatchObject({ applied: false, reason: "disabled", subtotalCents: 5_000 });
    expect(resolveWholesalePrice({ settings: { ...on, enabled: false }, approved: true, rules: [], lines: [line()] }).reason).toBe("disabled");
  });

  it("is retail for buyers who aren't approved", () => {
    const r = resolveWholesalePrice({ settings: on, approved: false, rules: [], lines: [line()] });
    expect(r).toMatchObject({ applied: false, reason: "not_approved" });
    expect(r.lines[0]).toEqual({ unitCents: 5_000, wholesale: false });
  });

  it("applies wholesale to lines that meet their minimum quantity only", () => {
    const rules: WholesaleRule[] = [{ productId: "p2", variantId: null, priceCents: 1_000, minQuantity: 6 }];
    const r = resolveWholesalePrice({
      settings: on, approved: true, rules,
      lines: [line({ quantity: 2 }), line({ productId: "p2", variantId: "v9", quantity: 5, retailUnitCents: 2_000, currentUnitCents: 2_000 })],
    });
    expect(r.applied).toBe(true);
    expect(r.lines).toEqual([{ unitCents: 3_000, wholesale: true }, { unitCents: 2_000, wholesale: false }]);
    expect(r.subtotalCents).toBe(2 * 3_000 + 5 * 2_000);
  });

  it("falls back to retail for the whole order below the minimum order value", () => {
    const r = resolveWholesalePrice({ settings: { ...on, minOrderCents: 10_000 }, approved: true, rules: [], lines: [line({ quantity: 3 })] });
    expect(r).toMatchObject({ applied: false, reason: "below_minimum", minOrderCents: 10_000, shortByCents: 1_000, subtotalCents: 15_000 });
    expect(r.lines[0].wholesale).toBe(false);
    const met = resolveWholesalePrice({ settings: { ...on, minOrderCents: 9_000 }, approved: true, rules: [], lines: [line({ quantity: 3 })] });
    expect(met).toMatchObject({ applied: true, subtotalCents: 9_000 });
  });

  it("never stacks with a sale: the lower of sale and wholesale wins", () => {
    // Sale already at $25 (retail $50); wholesale 40% off retail = $30 -> sale stays.
    const saleWins = resolveWholesalePrice({ settings: on, approved: true, rules: [], lines: [line({ currentUnitCents: 2_500 })] });
    expect(saleWins).toMatchObject({ applied: false, reason: "no_wholesale_lines" });
    expect(saleWins.lines[0].unitCents).toBe(2_500);
    // Sale at $45; wholesale $30 is lower -> $30, not $30 minus the sale.
    const wholesaleWins = resolveWholesalePrice({ settings: on, approved: true, rules: [], lines: [line({ currentUnitCents: 4_500 })] });
    expect(wholesaleWins.lines[0]).toEqual({ unitCents: 3_000, wholesale: true });
  });

  it("reports no wholesale lines when nothing in the order has a wholesale price", () => {
    const r = resolveWholesalePrice({ settings: { ...on, defaultPercentOff: 0 }, approved: true, rules: [], lines: [line()] });
    expect(r).toMatchObject({ applied: false, reason: "no_wholesale_lines" });
  });
});
