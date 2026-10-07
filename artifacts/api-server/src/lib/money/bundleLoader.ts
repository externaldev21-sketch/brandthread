/**
 * Database side of bundle pricing: loads the bundles a seller group's lines
 * are tagged with and hands them to the pure lib/money/bundlePricing.ts.
 * Every checkout path calls `priceGroupBundles`.
 */
import { inArray } from "drizzle-orm";
import { db, bundleItems, productBundles } from "@workspace/db";
import { priceBundles, type BundleCartLine, type BundleDef, type BundlePricing } from "./bundlePricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct, well-formed bundle ids tagged on the lines. */
export function taggedBundleIds(lines: Array<{ bundleId?: string | null }>): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    if (typeof line.bundleId === "string" && UUID.test(line.bundleId)) ids.add(line.bundleId.toLowerCase());
  }
  return [...ids];
}

export async function loadBundleDefs(ids: string[]): Promise<BundleDef[]> {
  if (ids.length === 0) return [];
  const bundles = await db.select().from(productBundles).where(inArray(productBundles.id, ids));
  if (bundles.length === 0) return [];
  const items = await db.select().from(bundleItems).where(inArray(bundleItems.bundleId, bundles.map((b) => b.id)));
  return bundles.map((b) => ({
    id: b.id,
    ownerId: b.ownerId,
    name: b.name,
    status: b.status,
    bundlePriceCents: b.bundlePriceCents,
    items: items.filter((i) => i.bundleId === b.id)
      .map((i) => ({ productId: i.productId, variantId: i.variantId ?? null, quantity: i.quantity })),
  }));
}

/** No bundle tagged: the zero answer, without a query. */
export function noBundles(count: number): BundlePricing {
  return {
    bundleDiscountCents: 0, applied: [], skipped: [],
    lineDiscountCents: Array.from({ length: count }, () => 0),
    lineBundleId: Array.from({ length: count }, () => null),
  };
}

/** Prices one seller group's bundles. Throws BundlePricingError for another seller's bundle. */
export async function priceGroupBundles(input: { sellerId: string; lines: BundleCartLine[] }): Promise<BundlePricing> {
  const lines = input.lines.map((line) => ({
    ...line,
    bundleId: typeof line.bundleId === "string" && UUID.test(line.bundleId) ? line.bundleId.toLowerCase() : null,
  }));
  const ids = taggedBundleIds(lines);
  if (ids.length === 0) return noBundles(lines.length);
  return priceBundles({ sellerId: input.sellerId, lines, bundles: await loadBundleDefs(ids) });
}
