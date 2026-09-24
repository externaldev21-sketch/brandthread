/**
 * Live badge data (price / stock) for saved product items.
 *
 * Shared by the buyer "Saved" feed (routes/saved.ts) and public collection
 * views (routes/public.ts) so both surfaces compute Price drop / Back in
 * stock / Low stock / Sold out the same way.
 */
import { inArray } from "drizzle-orm";
import { db, products, productVariants, users } from "@workspace/db";

const LOW_STOCK_THRESHOLD = 5;
const BACK_IN_STOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // badge fades after a week

export interface ProductBadgeInfo {
  image: string | null;
  brand: string;
  priceCents: number | null;
  inStock: boolean;
  lowStock: boolean;
  soldOut: boolean;
}

/** Fetch live price/stock/brand info for a set of product IDs, keyed by product ID. */
export async function fetchProductBadgeInfo(productIds: string[]): Promise<Map<string, ProductBadgeInfo>> {
  const result = new Map<string, ProductBadgeInfo>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const [productRows, variantRows] = await Promise.all([
    db.select({ id: products.id, name: products.name, images: products.images, ownerId: products.ownerId })
      .from(products)
      .where(inArray(products.id, ids)),
    db.select({
      productId: productVariants.productId,
      priceCents: productVariants.priceCents,
      stock: productVariants.stock,
    })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids)),
  ]);

  const ownerIds = [...new Set(productRows.map((p) => p.ownerId))];
  const sellerRows = ownerIds.length
    ? await db.select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
      .from(users)
      .where(inArray(users.clerkId, ownerIds))
    : [];
  const brandByOwner = new Map(sellerRows.map((s) => [s.clerkId, s.brandName ?? s.displayName ?? "Brand"]));

  const variantsByProduct = new Map<string, { priceCents: number; stock: number }[]>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push({ priceCents: v.priceCents, stock: v.stock });
    variantsByProduct.set(v.productId, list);
  }

  for (const p of productRows) {
    const variants = variantsByProduct.get(p.id) ?? [];
    const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
    const minPrice = variants.length ? Math.min(...variants.map((v) => v.priceCents)) : null;
    const images = Array.isArray(p.images) ? p.images.filter((i): i is string => typeof i === "string") : [];
    result.set(p.id, {
      image: images[0] ?? null,
      brand: brandByOwner.get(p.ownerId) ?? "Brand",
      priceCents: minPrice,
      inStock: totalStock > 0,
      lowStock: totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD,
      soldOut: totalStock === 0,
    });
  }

  return result;
}

/** True when a `backInStockAt` timestamp should still surface the badge. */
export function isBackInStockRecent(backInStockAt: Date | null): boolean {
  if (!backInStockAt) return false;
  return Date.now() - backInStockAt.getTime() < BACK_IN_STOCK_WINDOW_MS;
}

export { LOW_STOCK_THRESHOLD };
