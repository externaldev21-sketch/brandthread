import { describe, expect, it } from "vitest";
import { applyBundleDiscounts, type ActiveBundle, type BundleCartLine } from "../applyBundleDiscounts";

const line = (productId: string, unitPriceCents: number, quantity = 1, variantId = `${productId}-v`): BundleCartLine =>
  ({ productId, variantId, unitPriceCents, quantity });

const bundle = (id: string, bundlePriceCents: number, items: ActiveBundle["items"]): ActiveBundle =>
  ({ id, name: id, bundlePriceCents, items });

const tee = (variantId: string | null = null, quantity = 1) => ({ productId: "tee", variantId, quantity });
const cap = (variantId: string | null = null, quantity = 1) => ({ productId: "cap", variantId, quantity });
const sock = (variantId: string | null = null, quantity = 1) => ({ productId: "sock", variantId, quantity });

describe("applyBundleDiscounts", () => {
  it("takes the difference off an exact match", () => {
    const result = applyBundleDiscounts([line("tee", 4_000), line("cap", 2_500)], [bundle("set", 5_500, [tee(), cap()])]);
    expect(result.totalDiscountCents).toBe(1_000);
    expect(result.applied).toEqual([{ bundleId: "set", name: "set", copies: 1, discountCents: 1_000 }]);
    expect(result.lineDiscountCents.reduce((a, b) => a + b, 0)).toBe(1_000);
  });

  it("gives nothing for a partial set", () => {
    const result = applyBundleDiscounts([line("tee", 4_000)], [bundle("set", 5_500, [tee(), cap()])]);
    expect(result).toEqual({ totalDiscountCents: 0, applied: [], lineDiscountCents: [0] });
  });

  it("needs the full quantity of each item", () => {
    const result = applyBundleDiscounts([line("tee", 4_000, 1), line("cap", 2_500)], [bundle("set", 8_000, [tee(null, 2), cap()])]);
    expect(result.totalDiscountCents).toBe(0);
  });

  it("applies two copies when the cart holds two sets, and not a third", () => {
    const result = applyBundleDiscounts([line("tee", 4_000, 3), line("cap", 2_500, 2)], [bundle("set", 5_500, [tee(), cap()])]);
    expect(result.applied).toEqual([{ bundleId: "set", name: "set", copies: 2, discountCents: 2_000 }]);
    expect(result.totalDiscountCents).toBe(2_000);
  });

  it("picks the bigger saving when bundles share units", () => {
    const lines = [line("tee", 4_000), line("cap", 2_500), line("sock", 2_000)];
    const result = applyBundleDiscounts(lines, [
      bundle("tee+cap", 6_000, [tee(), cap()]), // saves 500
      bundle("tee+sock", 4_500, [tee(), sock()]), // saves 1,500
    ]);
    expect(result.applied.map((a) => a.bundleId)).toEqual(["tee+sock"]);
    expect(result.totalDiscountCents).toBe(1_500);
    expect(result.lineDiscountCents[1]).toBe(0); // the cap is not discounted
  });

  it("uses disjoint units for two different bundles", () => {
    const lines = [line("tee", 4_000, 2), line("cap", 2_500), line("sock", 2_000)];
    const result = applyBundleDiscounts(lines, [
      bundle("tee+cap", 6_000, [tee(), cap()]),
      bundle("tee+sock", 4_500, [tee(), sock()]),
    ]);
    expect(result.totalDiscountCents).toBe(2_000);
    expect(result.applied).toHaveLength(2);
  });

  it("only matches the pinned variant", () => {
    const pinned = bundle("set", 5_000, [tee("tee-black"), cap()]);
    const wrong = applyBundleDiscounts([line("tee", 4_000, 1, "tee-white"), line("cap", 2_500)], [pinned]);
    expect(wrong.totalDiscountCents).toBe(0);
    const right = applyBundleDiscounts([line("tee", 4_000, 1, "tee-white"), line("tee", 4_000, 1, "tee-black"), line("cap", 2_500)], [pinned]);
    expect(right.totalDiscountCents).toBe(1_500);
    expect(right.lineDiscountCents[0]).toBe(0);
  });

  it("an unpinned item matches any variant of the product", () => {
    const result = applyBundleDiscounts(
      [line("tee", 4_000, 1, "tee-s"), line("tee", 4_000, 1, "tee-m"), line("cap", 2_500)],
      [bundle("set", 9_000, [tee(null, 2), cap()])],
    );
    expect(result.totalDiscountCents).toBe(1_500);
  });

  it("gives nothing when prices drop to or below the bundle price", () => {
    expect(applyBundleDiscounts([line("tee", 3_000), line("cap", 2_500)], [bundle("set", 5_500, [tee(), cap()])]).totalDiscountCents).toBe(0);
    expect(applyBundleDiscounts([line("tee", 2_000), line("cap", 2_500)], [bundle("set", 5_500, [tee(), cap()])]).totalDiscountCents).toBe(0);
  });

  it("ignores empty and zero-priced bundles, so merchandise is never given away", () => {
    const result = applyBundleDiscounts([line("tee", 4_000), line("cap", 2_500)], [
      bundle("free", 0, [tee(), cap()]),
      bundle("empty", 100, []),
    ]);
    expect(result.totalDiscountCents).toBe(0);
  });

  it("never discounts more than the matched lines", () => {
    const lines = [line("tee", 4_001, 3), line("cap", 2_999, 1)];
    const result = applyBundleDiscounts(lines, [bundle("set", 1, [tee(null, 3), cap()])]);
    expect(result.totalDiscountCents).toBe(4_001 * 3 + 2_999 - 1);
    result.lineDiscountCents.forEach((cents, i) => {
      expect(cents).toBeGreaterThanOrEqual(0);
      expect(cents).toBeLessThanOrEqual(lines[i].unitPriceCents * lines[i].quantity);
    });
  });
});
