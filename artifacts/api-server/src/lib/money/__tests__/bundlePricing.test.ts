import { describe, expect, it } from "vitest";
import {
  BundlePricingError, linesAfterBundles, priceBundles, splitProportionally, type BundleDef, type BundleCartLine,
} from "../bundlePricing";

const SELLER = "seller-1";

function bundle(overrides: Partial<BundleDef> = {}): BundleDef {
  return {
    id: "b1",
    ownerId: SELLER,
    name: "Fit set",
    status: "active",
    bundlePriceCents: 8_000,
    items: [
      { productId: "tee", variantId: null, quantity: 1 },
      { productId: "pant", variantId: "pant-m", quantity: 1 },
    ],
    ...overrides,
  };
}

const tee = (qty = 1, bundleId: string | null = "b1"): BundleCartLine =>
  ({ variantId: "tee-m", productId: "tee", quantity: qty, priceCents: 4_000, bundleId });
const pant = (qty = 1, bundleId: string | null = "b1"): BundleCartLine =>
  ({ variantId: "pant-m", productId: "pant", quantity: qty, priceCents: 6_000, bundleId });

describe("priceBundles", () => {
  it("takes the difference between the items and the bundle price off a complete set", () => {
    const result = priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [bundle()] });
    expect(result.bundleDiscountCents).toBe(2_000);
    expect(result.applied).toEqual([{ bundleId: "b1", name: "Fit set", sets: 1, itemsCents: 10_000, bundlePriceCents: 8_000, discountCents: 2_000 }]);
    // Spread by line value: 40% / 60%.
    expect(result.lineDiscountCents).toEqual([800, 1_200]);
    expect(result.lineBundleId).toEqual(["b1", "b1"]);
  });

  it("applies nothing when an item is missing (removing an item drops the saving)", () => {
    const result = priceBundles({ sellerId: SELLER, lines: [tee()], bundles: [bundle()] });
    expect(result.bundleDiscountCents).toBe(0);
    expect(result.skipped).toEqual([{ bundleId: "b1", reason: "incomplete" }]);
    expect(result.lineDiscountCents).toEqual([0]);
    expect(result.lineBundleId).toEqual([null]);
  });

  it("applies several sets when quantities allow, and only full sets", () => {
    const result = priceBundles({ sellerId: SELLER, lines: [tee(3), pant(2)], bundles: [bundle()] });
    expect(result.applied[0]).toMatchObject({ sets: 2, itemsCents: 20_000, discountCents: 4_000 });
    expect(result.lineDiscountCents.reduce((a, b) => a + b, 0)).toBe(4_000);
  });

  it("requires the item quantity of the bundle", () => {
    const twoTees = bundle({ items: [{ productId: "tee", variantId: null, quantity: 2 }, { productId: "pant", variantId: null, quantity: 1 }], bundlePriceCents: 12_000 });
    expect(priceBundles({ sellerId: SELLER, lines: [tee(1), pant(1)], bundles: [twoTees] }).bundleDiscountCents).toBe(0);
    expect(priceBundles({ sellerId: SELLER, lines: [tee(2), pant(1)], bundles: [twoTees] }).bundleDiscountCents).toBe(2_000);
  });

  it("needs the exact variant when the bundle fixes one", () => {
    const otherPant: BundleCartLine = { variantId: "pant-l", productId: "pant", quantity: 1, priceCents: 6_000, bundleId: "b1" };
    expect(priceBundles({ sellerId: SELLER, lines: [tee(), otherPant], bundles: [bundle()] }).bundleDiscountCents).toBe(0);
  });

  it("accepts any variant of a product when the bundle leaves it open, across lines", () => {
    const open = bundle({ items: [{ productId: "tee", variantId: null, quantity: 2 }], bundlePriceCents: 7_000 });
    const s: BundleCartLine = { variantId: "tee-s", productId: "tee", quantity: 1, priceCents: 4_000, bundleId: "b1" };
    const l: BundleCartLine = { variantId: "tee-l", productId: "tee", quantity: 1, priceCents: 4_000, bundleId: "b1" };
    const result = priceBundles({ sellerId: SELLER, lines: [s, l], bundles: [open] });
    expect(result.bundleDiscountCents).toBe(1_000);
    expect(result.lineDiscountCents).toEqual([500, 500]);
  });

  it("is never negative and never more than the lines", () => {
    const pricey = bundle({ bundlePriceCents: 50_000 });
    const pricing = priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [pricey] });
    expect(pricing.bundleDiscountCents).toBe(0);
    expect(pricing.skipped).toEqual([{ bundleId: "b1", reason: "no_saving" }]);
    const free = bundle({ bundlePriceCents: 0 });
    expect(priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [free] }).bundleDiscountCents).toBe(10_000);
    const negative = bundle({ bundlePriceCents: -500 });
    expect(priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [negative] }).bundleDiscountCents).toBe(10_000);
  });

  it("does not apply archived or draft bundles, or ones the database no longer has", () => {
    for (const status of ["archived", "draft"]) {
      const result = priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [bundle({ status })] });
      expect(result.bundleDiscountCents).toBe(0);
      expect(result.skipped).toEqual([{ bundleId: "b1", reason: "inactive" }]);
    }
    const gone = priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [] });
    expect(gone.skipped).toEqual([{ bundleId: "b1", reason: "not_found" }]);
  });

  it("ignores bundles nobody tagged (only bundles the buyer added apply)", () => {
    const result = priceBundles({ sellerId: SELLER, lines: [tee(1, null), pant(1, null)], bundles: [bundle()] });
    expect(result.bundleDiscountCents).toBe(0);
    expect(result.applied).toEqual([]);
  });

  it("counts lines tagged with the bundle and untagged lines of the same items", () => {
    // Buyer added the bundle, then the same pants separately (cart merged them).
    const result = priceBundles({ sellerId: SELLER, lines: [tee(1, "b1"), pant(1, null)], bundles: [bundle()] });
    expect(result.bundleDiscountCents).toBe(2_000);
  });

  it("refuses a bundle from another seller", () => {
    expect(() => priceBundles({ sellerId: SELLER, lines: [tee(), pant()], bundles: [bundle({ ownerId: "seller-2" })] }))
      .toThrow(BundlePricingError);
  });

  it("never lets one unit count toward two bundles", () => {
    const b2 = bundle({ id: "b2", name: "Tee pair", items: [{ productId: "tee", variantId: null, quantity: 1 }, { productId: "pant", variantId: null, quantity: 1 }], bundlePriceCents: 9_000 });
    const lines: BundleCartLine[] = [tee(1, "b1"), pant(1, "b2")];
    const result = priceBundles({ sellerId: SELLER, lines, bundles: [bundle(), b2] });
    expect(result.applied.map((a) => a.bundleId)).toEqual(["b1"]);
    expect(result.skipped).toEqual([{ bundleId: "b2", reason: "incomplete" }]);
  });

  it("gives the same answer when called twice (idempotent)", () => {
    const input = { sellerId: SELLER, lines: [tee(2), pant(2)], bundles: [bundle()] };
    expect(priceBundles(input)).toEqual(priceBundles(input));
  });
});

describe("splitProportionally", () => {
  it("is exact to the cent and skips zero weights", () => {
    expect(splitProportionally([100, 100, 100], 100)).toEqual([33, 33, 34]);
    expect(splitProportionally([1, 1, 1], 100)).toEqual([1, 1, 1]); // capped at the weights
    expect(splitProportionally([0, 500, 0], 100)).toEqual([0, 100, 0]);
    expect(splitProportionally([10, 0], 0)).toEqual([0, 0]);
  });
});

describe("linesAfterBundles", () => {
  it("keeps the units and the exact remaining total for the discount code", () => {
    const lines = [{ productId: "tee", priceCents: 4_000, quantity: 3 }, { productId: "pant", priceCents: 6_000, quantity: 1 }];
    const after = linesAfterBundles(lines, [1_001, 0]);
    expect(after.reduce((n, l) => n + l.quantity, 0)).toBe(4);
    expect(after.reduce((n, l) => n + l.priceCents * l.quantity, 0)).toBe(12_000 + 6_000 - 1_001);
    expect(after.filter((l) => l.productId === "tee").map((l) => l.priceCents).sort()).toEqual([3_666, 3_667]);
  });
});
