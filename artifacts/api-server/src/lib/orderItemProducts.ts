import { inArray } from "drizzle-orm";
import { db, products, productVariants } from "@workspace/db";

/**
 * Order line items only store the purchased variant. Order detail screens link
 * each line to its product page, so resolve the owning product id per item
 * (null when the variant has since been deleted).
 *
 * `{ sku: true }` (seller order detail) also returns the variant's SKU, for
 * packing slips; null when the variant has since been deleted.
 */
export async function withItemProductIds<T extends { variantId: string | null }>(
  items: T[],
): Promise<Array<T & { productId: string | null }>>;
export async function withItemProductIds<T extends { variantId: string | null }>(
  items: T[],
  options: { sku: true },
): Promise<Array<T & { productId: string | null; sku: string | null }>>;
export async function withItemProductIds<T extends { variantId: string | null }>(
  items: T[],
  options?: { sku?: boolean },
): Promise<Array<T & { productId: string | null; sku?: string | null }>> {
  const variantIds = [...new Set(items.map((item) => item.variantId).filter((id): id is string => !!id))];
  if (variantIds.length === 0) {
    return items.map((item) => ({ ...item, productId: null, ...(options?.sku ? { sku: null } : {}) }));
  }
  const rows = await db
    .select({ id: productVariants.id, productId: productVariants.productId, sku: productVariants.sku })
    .from(productVariants)
    .where(inArray(productVariants.id, variantIds));
  const byVariant = new Map(rows.map((row) => [row.id, row]));
  return items.map((item) => {
    const variant = item.variantId ? byVariant.get(item.variantId) : undefined;
    return {
      ...item,
      productId: variant?.productId ?? null,
      ...(options?.sku ? { sku: variant?.sku ?? null } : {}),
    };
  });
}

/**
 * The seller's order detail shows a square photo per line: the product's
 * first image, or null when the product is gone or has no photo.
 */
export async function withItemImageUrls<T extends { productId: string | null }>(
  items: T[],
): Promise<Array<T & { imageUrl: string | null }>> {
  const productIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => !!id))];
  if (productIds.length === 0) return items.map((item) => ({ ...item, imageUrl: null }));
  const rows = await db
    .select({ id: products.id, images: products.images })
    .from(products)
    .where(inArray(products.id, productIds));
  const imageByProduct = new Map(rows.map((row) => [row.id, Array.isArray(row.images) ? row.images.find((u) => typeof u === "string" && u) ?? null : null]));
  return items.map((item) => ({
    ...item,
    imageUrl: item.productId ? imageByProduct.get(item.productId) ?? null : null,
  }));
}
