/**
 * Loads a seller's active bundles and prices them against one seller group's
 * lines. Shared by every checkout path (one-page quote/intent via
 * lib/money/cartCheckout.ts, hosted /checkout/session in routes/buyer.ts and
 * guest checkout) so they can never disagree.
 */
import { and, eq, inArray } from "drizzle-orm";
import { bundleItems, db, productBundles } from "@workspace/db";
import { applyBundleDiscounts, type ActiveBundle, type BundleCartLine, type BundleDiscountResult } from "./applyBundleDiscounts";

export async function loadActiveBundles(sellerId: string, productIds: string[]): Promise<ActiveBundle[]> {
  if (productIds.length === 0) return [];
  // Only bundles that contain at least one product in the group can apply.
  const candidates = await db.selectDistinct({ id: productBundles.id })
    .from(productBundles)
    .innerJoin(bundleItems, eq(bundleItems.bundleId, productBundles.id))
    .where(and(
      eq(productBundles.ownerId, sellerId),
      eq(productBundles.status, "active"),
      inArray(bundleItems.productId, productIds),
    ));
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  const [bundles, items] = await Promise.all([
    db.select({ id: productBundles.id, name: productBundles.name, bundlePriceCents: productBundles.bundlePriceCents })
      .from(productBundles).where(inArray(productBundles.id, ids)),
    db.select({
      bundleId: bundleItems.bundleId, productId: bundleItems.productId,
      variantId: bundleItems.variantId, quantity: bundleItems.quantity,
    }).from(bundleItems).where(inArray(bundleItems.bundleId, ids)),
  ]);
  return bundles.map((bundle) => ({
    ...bundle,
    items: items.filter((item) => item.bundleId === bundle.id)
      .map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity })),
  }));
}

export async function bundleDiscountsForGroup(sellerId: string, lines: BundleCartLine[]): Promise<BundleDiscountResult> {
  const bundles = await loadActiveBundles(sellerId, [...new Set(lines.map((line) => line.productId))]);
  return applyBundleDiscounts(lines, bundles);
}
