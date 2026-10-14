/**
 * Product photos and listing counts for GET /api/public/brands/discover —
 * what buyer onboarding's "Curate your feed" step needs to show each brand
 * Grailed-style: three of its own listing photos and how many it has live.
 *
 * Pure shaping, unit-tested without a database (the route does the reads).
 * Photos are the first image of each of the brand's newest active products,
 * never stock or generated art.
 */

export const PHOTOS_PER_BRAND = 3;

export interface BrandProductRow {
  ownerId: string;
  images: unknown;
}

export interface BrandProducts {
  productCount: number;
  productImages: string[];
}

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const image = images.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return image ?? null;
}

/**
 * Per seller: up to PHOTOS_PER_BRAND distinct photos (one per product, in the
 * newest-first order given) and the active product count.
 */
export function brandProductsBySeller(
  sellerIds: string[],
  productsNewestFirst: BrandProductRow[],
  activeCounts: Map<string, number>,
): Map<string, BrandProducts> {
  const out = new Map<string, BrandProducts>();
  for (const id of sellerIds) out.set(id, { productCount: activeCounts.get(id) ?? 0, productImages: [] });
  for (const product of productsNewestFirst) {
    const entry = out.get(product.ownerId);
    if (!entry || entry.productImages.length >= PHOTOS_PER_BRAND) continue;
    const image = firstImage(product.images);
    if (image && !entry.productImages.includes(image)) entry.productImages.push(image);
  }
  return out;
}

/**
 * Brands with photos to show come first, keeping the incoming (newest-first)
 * order within each group, so the step opens on real products.
 */
export function photoBrandsFirst<T extends { productImages: string[] }>(brands: T[]): T[] {
  return [
    ...brands.filter((b) => b.productImages.length > 0),
    ...brands.filter((b) => b.productImages.length === 0),
  ];
}
