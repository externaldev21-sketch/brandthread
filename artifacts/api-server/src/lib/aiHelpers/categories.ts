/**
 * Product categories the seller app offers in its category picker
 * (artifacts/mobile/services/productTypes.ts → PRODUCT_CATEGORIES). Keep the
 * two lists identical: the product-description helper may suggest one of
 * these, and the app only prefills a value its own picker knows.
 */
export const PRODUCT_CATEGORIES = [
  "T-shirt", "Hoodie", "Sweatshirt", "Sweatpants", "Shorts",
  "Jacket", "Denim", "Dress", "Skirt", "Hat", "Bag", "Shoes",
  "Accessories", "Other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Maps a model answer onto the exact category spelling, or null when it is not one of ours. */
export function pickCategory(value: unknown): ProductCategory | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return null;
  return PRODUCT_CATEGORIES.find((c) => c.toLowerCase().replace(/[\s_-]+/g, "") === key) ?? null;
}
