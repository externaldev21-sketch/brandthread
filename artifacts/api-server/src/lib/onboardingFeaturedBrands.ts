/**
 * Onboarding's featured brands (Dev's less-AI pass, item 54: real products
 * from Dev's own brands on onboarding).
 *
 * ONBOARDING_FEATURED_SELLER_HANDLES lists the brands, by Brandthread handle
 * (username), comma separated, in display order — e.g.
 * "northlinestudio,emberandash,quiethours". Unset or empty → no featured
 * brands and the onboarding step looks exactly as before. Each brand shows its
 * own newest active products' first photos, never stock or generated images.
 */

export const MAX_FEATURED_BRANDS = 3;
export const PHOTOS_PER_BRAND = 3;

/** Handles from the env value: trimmed, "@" dropped, lower-cased, de-duplicated, capped. */
export function parseFeaturedHandles(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const handle = part.trim().replace(/^@+/, "").toLowerCase();
    if (handle && /^[a-z0-9._-]+$/.test(handle)) seen.add(handle);
    if (seen.size >= MAX_FEATURED_BRANDS) break;
  }
  return [...seen];
}

export interface FeaturedSellerRow {
  clerkId: string;
  username: string | null;
  displayName: string | null;
  brandName: string | null;
  profileImageUrl: string | null;
  avatarUrl: string | null;
  verified: boolean;
}

export interface FeaturedProductRow {
  ownerId: string;
  images: unknown;
}

export interface FeaturedBrand {
  id: string;
  sellerId: string;
  handle: string;
  name: string;
  logoUrl: string | null;
  verified: boolean;
  productCount: number;
  productImages: string[];
}

function firstImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const image = images.find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return image ?? null;
}

/**
 * Brands in the configured order, each with up to PHOTOS_PER_BRAND product
 * photos (one per product, newest first as given). A brand with no product
 * photo is left out — the rail only shows real products.
 */
export function shapeFeaturedBrands(
  handles: string[],
  sellers: FeaturedSellerRow[],
  productsNewestFirst: FeaturedProductRow[],
  productCounts: Map<string, number>,
): FeaturedBrand[] {
  const byHandle = new Map(sellers.filter((s) => s.username).map((s) => [s.username!.toLowerCase(), s]));
  const photos = new Map<string, string[]>();
  for (const product of productsNewestFirst) {
    const image = firstImage(product.images);
    if (!image) continue;
    const list = photos.get(product.ownerId) ?? [];
    if (list.length < PHOTOS_PER_BRAND && !list.includes(image)) list.push(image);
    photos.set(product.ownerId, list);
  }
  const out: FeaturedBrand[] = [];
  for (const handle of handles) {
    const seller = byHandle.get(handle);
    if (!seller) continue;
    const productImages = photos.get(seller.clerkId) ?? [];
    if (productImages.length === 0) continue;
    out.push({
      id: seller.clerkId,
      sellerId: seller.clerkId,
      handle: seller.username!,
      name: seller.brandName || seller.displayName || seller.username!,
      logoUrl: seller.profileImageUrl ?? seller.avatarUrl ?? null,
      verified: seller.verified,
      productCount: productCounts.get(seller.clerkId) ?? productImages.length,
      productImages,
    });
  }
  return out;
}
