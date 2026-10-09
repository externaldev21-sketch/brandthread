import { describe, expect, it } from "vitest";
import { buildDefaultVariant, defaultVariantSku } from "../defaultVariant";

describe("default variant for a simple product (BT-205)", () => {
  it("prices and stocks the single variant from the product fields", () => {
    const variant = buildDefaultVariant({ name: "Logo Tee", priceCents: 3_500, stock: 12, compareAtPriceCents: 4_500 });
    expect(variant).toMatchObject({ priceCents: 3_500, stock: 12, compareAtPriceCents: 4_500, lowStockThreshold: 10 });
    expect((variant as { sku: string }).sku).toMatch(/^LOGO-TEE-[0-9A-F]{8}$/);
  });

  it("returns null when no price was sent (drafts), and errors on bad input", () => {
    expect(buildDefaultVariant({ name: "Draft", priceCents: undefined })).toBeNull();
    expect(buildDefaultVariant({ name: "Free", priceCents: 0 })).toEqual({ error: "priceCents must be a positive integer" });
    expect(buildDefaultVariant({ name: "Cents", priceCents: 12.5 })).toEqual({ error: "priceCents must be a positive integer" });
    expect(buildDefaultVariant({ name: "Neg", priceCents: 1_000, stock: -1 })).toEqual({ error: "stock must be a non-negative integer" });
  });

  it("drops a strike-through price that isn't above the price", () => {
    expect(buildDefaultVariant({ name: "Cap", priceCents: 2_000, compareAtPriceCents: 1_500 })).toMatchObject({ compareAtPriceCents: null });
  });

  it("makes SKUs that don't collide between sellers using the same product name", () => {
    expect(defaultVariantSku("Tote", () => "a1b2c3d4")).toBe("TOTE-A1B2C3D4");
    expect(defaultVariantSku("★★★", () => "00ff00ff")).toBe("ITEM-00FF00FF");
    expect(defaultVariantSku("Tote")).not.toBe(defaultVariantSku("Tote"));
  });
});
