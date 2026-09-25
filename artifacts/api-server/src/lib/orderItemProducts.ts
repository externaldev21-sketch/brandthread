import { inArray } from "drizzle-orm";
import { db, productVariants } from "@workspace/db";

/**
 * Order line items only store the purchased variant. Order detail screens link
 * each line to its product page, so resolve the owning product id per item
 * (null when the variant has since been deleted).
 */
export async function withItemProductIds<T extends { variantId: string | null }>(
  items: T[],
): Promise<Array<T & { productId: string | null }>> {
  const variantIds = [...new Set(items.map((item) => item.variantId).filter((id): id is string => !!id))];
  if (variantIds.length === 0) return items.map((item) => ({ ...item, productId: null }));
  const rows = await db
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, variantIds));
  const productByVariant = new Map(rows.map((row) => [row.id, row.productId]));
  return items.map((item) => ({
    ...item,
    productId: item.variantId ? productByVariant.get(item.variantId) ?? null : null,
  }));
}
