import { describe, expect, it } from "vitest";
import {
  resolveReorder,
  parseVariantLabel,
  type ReorderCatalogProduct,
  type ReorderLine,
} from "../reorderResolver";

const variant = (over: Partial<ReorderCatalogProduct["variants"][number]> = {}) => ({
  id: "v1", size: "M", color: "Black", sku: "TEE-M-BLK", priceCents: 4000, stock: 10, ...over,
});
const product = (over: Partial<ReorderCatalogProduct> = {}): ReorderCatalogProduct => ({
  id: "p1", name: "Classic Tee", status: "active", deletedAt: null, isPreOrder: false,
  variants: [variant()], ...over,
});
const line = (over: Partial<ReorderLine> = {}): ReorderLine => ({
  variantId: "v1", productName: "Classic Tee", variantLabel: "M / Black", quantity: 2, priceCents: 4000, ...over,
});

describe("resolveReorder", () => {
  it("adds an unchanged in-stock line at the same price", () => {
    const r = resolveReorder([line()], [product()]);
    expect(r.unavailable).toEqual([]);
    expect(r.addable).toEqual([{
      productId: "p1", variantId: "v1", quantity: 2, requestedQuantity: 2, quantityClamped: false,
      currentPriceCents: 4000, priceChanged: false, previousPriceCents: 4000,
    }]);
  });

  it("clamps quantity to current stock", () => {
    const r = resolveReorder([line({ quantity: 5 })], [product({ variants: [variant({ stock: 3 })] })]);
    expect(r.addable[0]).toMatchObject({ quantity: 3, requestedQuantity: 5, quantityClamped: true });
  });

  it("reports out_of_stock when stock is zero", () => {
    const r = resolveReorder([line()], [product({ variants: [variant({ stock: 0 })] })]);
    expect(r.addable).toEqual([]);
    expect(r.unavailable).toEqual([{ productId: "p1", title: "Classic Tee", reason: "out_of_stock" }]);
  });

  it("does not treat pre-order variants with zero stock as out of stock", () => {
    const r = resolveReorder([line()], [product({ isPreOrder: true, variants: [variant({ stock: 0 })] })]);
    expect(r.addable[0]).toMatchObject({ quantity: 2, quantityClamped: false });
  });

  it("flags a price change with the previous and current price", () => {
    const r = resolveReorder([line()], [product({ variants: [variant({ priceCents: 4500 })] })]);
    expect(r.addable[0]).toMatchObject({ currentPriceCents: 4500, priceChanged: true, previousPriceCents: 4000 });
  });

  it("reports variant_removed when the variant row is gone and no size/color matches", () => {
    const r = resolveReorder([line({ variantId: "gone", variantLabel: "XL / Red" })], [product()]);
    expect(r.unavailable).toEqual([{ productId: "p1", title: "Classic Tee", reason: "variant_removed" }]);
  });

  it("re-matches a deleted variant by size + color on the same product", () => {
    const r = resolveReorder(
      [line({ variantId: "gone", variantLabel: "black / m" })],
      [product({ variants: [variant({ id: "v9" })] })],
    );
    expect(r.addable[0]).toMatchObject({ variantId: "v9", productId: "p1" });
  });

  it("re-matches by sku", () => {
    const r = resolveReorder(
      [line({ variantId: null, sku: "tee-m-blk", variantLabel: null, productName: "Renamed" })],
      [product({ variants: [variant({ id: "v7" })] })],
    );
    expect(r.addable[0]?.variantId).toBe("v7");
  });

  it("reports discontinued for a deleted product, archived product, or one that no longer exists", () => {
    const deleted = resolveReorder([line()], [product({ deletedAt: new Date() })]);
    expect(deleted.unavailable[0]?.reason).toBe("discontinued");
    const archived = resolveReorder([line()], [product({ status: "archived" })]);
    expect(archived.unavailable[0]?.reason).toBe("discontinued");
    const missing = resolveReorder([line({ variantId: null })], []);
    expect(missing.unavailable).toEqual([{ productId: null, title: "Classic Tee", reason: "discontinued" }]);
  });

  it("does not crash on empty input and splits a mixed order", () => {
    expect(resolveReorder([], [])).toEqual({ addable: [], unavailable: [] });
    const r = resolveReorder([line(), line({ variantId: "x", productName: "Gone Hoodie" })], [product()]);
    expect(r.addable).toHaveLength(1);
    expect(r.unavailable).toHaveLength(1);
  });

  it("merges two lines of the same variant and clamps the total", () => {
    const r = resolveReorder(
      [line({ quantity: 2 }), line({ quantity: 3 })],
      [product({ variants: [variant({ stock: 4 })] })],
    );
    expect(r.addable).toHaveLength(1);
    expect(r.addable[0]).toMatchObject({ quantity: 4, requestedQuantity: 5, quantityClamped: true });
  });
});

describe("parseVariantLabel", () => {
  it("splits size and colour labels", () => {
    expect(parseVariantLabel("M / Black")).toEqual(["m", "black"]);
    expect(parseVariantLabel(null)).toEqual([]);
  });
});
