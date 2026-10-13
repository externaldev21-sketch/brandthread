/**
 * Server port of the pure size-matching pieces the mobile app uses for its
 * size badge (artifacts/mobile/lib/sizeRecommendation.ts `sizeCategoryFor`,
 * artifacts/mobile/lib/sizeBadge.ts `productSizeLabels` / `matchSizeLabel`).
 * Behaviour is kept identical to the client; keep the two in step.
 */
import type { StoredSizes } from "./buyerPreferences";

export type SizeCategory = "tops" | "bottoms" | "outerwear" | "shoes";

/** Best-effort mapping from a product's free-text category / name to a size category. */
export function sizeCategoryFor(text: string | null | undefined): SizeCategory | null {
  const t = (text ?? "").toLowerCase();
  if (!t) return null;
  if (/shoe|sneaker|boot|sandal|loafer|heel|footwear/.test(t)) return "shoes";
  if (/jacket|coat|parka|puffer|outerwear|blazer|windbreaker/.test(t)) return "outerwear";
  if (/pant|jean|trouser|short|skirt|legging|bottom|jogger|denim/.test(t)) return "bottoms";
  if (/top|tee|t-shirt|shirt|hoodie|sweat|knit|sweater|dress|apparel|blouse|tank|crew/.test(t)) return "tops";
  return null;
}

/** A product's size category: its category text first, then its name (as the mobile badge does). */
export function productSizeCategory(product: { category?: string | null; name?: string | null }): SizeCategory | null {
  return sizeCategoryFor(product.category) ?? sizeCategoryFor(product.name);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

/** The product's size chip labels (the option named "Size"), or null when it has none. */
export function productSizeLabels(
  product: { options?: Array<{ name: string; values: Array<{ label: string }> }> } | null | undefined,
): string[] | null {
  const opt = product?.options?.find((o) => o.name.toLowerCase() === "size");
  return opt ? opt.values.map((v) => v.label) : null;
}

/** The chip label that matches a size ("m" matches "M"), or null. */
export function matchSizeLabel(size: string, labels: string[] | null | undefined): string | null {
  if (!labels) return null;
  return labels.find((l) => norm(l) === norm(size)) ?? null;
}

/**
 * True when the buyer's saved size for `category` is the variant's size label.
 * Missing category, saved size or variant size never matches.
 */
export function savedSizeMatchesVariant(
  sizes: StoredSizes | null | undefined,
  category: SizeCategory | null,
  variantSize: string | null | undefined,
): boolean {
  if (!category || !variantSize || !variantSize.trim()) return false;
  const saved = sizes?.[category];
  if (typeof saved !== "string" || !saved.trim()) return false;
  return matchSizeLabel(saved, [variantSize]) !== null;
}
