/**
 * Simple products (no size/colour options) still need one product_variants
 * row: checkout, the cart and the buyer product page price and stock only
 * from variants (BT-205). POST /api/products builds that row from the
 * product-level price when the seller sent no variants.
 */
import crypto from "node:crypto";

export type DefaultVariantInput = {
  name: string;
  priceCents: unknown;
  stock?: unknown;
  compareAtPriceCents?: unknown;
  lowStockThreshold?: unknown;
};

export type DefaultVariant = {
  sku: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
  lowStockThreshold: number;
};

/** SKUs are unique across every seller, so the default one gets a random tail. */
export function defaultVariantSku(name: string, random: () => string = () => crypto.randomBytes(4).toString("hex")): string {
  const stem = name.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).toUpperCase() || "ITEM";
  return `${stem}-${random().toUpperCase()}`;
}

/**
 * The default variant, null when no product price was sent (a draft may be
 * saved without one), or an error message for a price/stock that is invalid.
 */
export function buildDefaultVariant(input: DefaultVariantInput): DefaultVariant | null | { error: string } {
  if (input.priceCents === undefined || input.priceCents === null) return null;
  if (!Number.isInteger(input.priceCents) || (input.priceCents as number) <= 0) {
    return { error: "priceCents must be a positive integer" };
  }
  const priceCents = input.priceCents as number;
  const stock = input.stock ?? 0;
  if (!Number.isInteger(stock) || (stock as number) < 0) return { error: "stock must be a non-negative integer" };
  const threshold = input.lowStockThreshold ?? 10;
  if (!Number.isInteger(threshold) || (threshold as number) < 0) return { error: "lowStockThreshold must be a non-negative integer" };
  let compareAtPriceCents: number | null = null;
  if (input.compareAtPriceCents !== undefined && input.compareAtPriceCents !== null) {
    // Same rule as listed variants; an invalid strike-through is dropped, not fatal.
    if (Number.isInteger(input.compareAtPriceCents) && (input.compareAtPriceCents as number) > priceCents) {
      compareAtPriceCents = input.compareAtPriceCents as number;
    }
  }
  return {
    sku: defaultVariantSku(input.name),
    priceCents,
    compareAtPriceCents,
    stock: stock as number,
    lowStockThreshold: threshold as number,
  };
}
