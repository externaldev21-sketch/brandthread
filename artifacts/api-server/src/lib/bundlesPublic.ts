/**
 * Product bundles as buyers see them, and bundle sales as sellers see them.
 *
 * Public bundles: only `active` bundles whose every product is live (active,
 * not deleted) and buyable at the bundle's quantity (in stock — a fixed
 * variant, or any variant when the seller left the size open), and that
 * actually save money. Prices come from the database; the savings shown are
 * computed here, and checkout recomputes them (lib/money/bundlePricing.ts).
 *
 * Sales follow the analytics definition in routes/analytics.ts: paid, not
 * cancelled, net of refunds (an order's refund is shared pro rata over what
 * was in it).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, bundleItems, productBundles, productVariants, products, users } from "@workspace/db";

export type PublicBundleVariant = { id: string; size: string | null; color: string | null; priceCents: number; stock: number };

export type PublicBundleItem = {
  id: string;
  productId: string;
  /** Fixed variant, or null when the buyer picks the size. */
  variantId: string | null;
  quantity: number;
  productName: string;
  image: string | null;
  images: string[];
  /** Unit price (the fixed variant's, else the cheapest in-stock variant's). */
  priceCents: number;
  size: string | null;
  color: string | null;
  /** In-stock variants the buyer can choose from (only the fixed one when fixed). */
  variants: PublicBundleVariant[];
};

export type PublicBundle = {
  id: string;
  sellerId: string;
  sellerName: string | null;
  name: string;
  description: string | null;
  images: string[];
  bundlePriceCents: number;
  /** Sum of the items at their own prices. */
  itemsTotalCents: number;
  /** What the seller shows as the "was" price (their compare-at, else the items total). */
  compareAtCents: number;
  savingsCents: number;
  /** True when at least one item needs a size chosen. */
  needsSelection: boolean;
  items: PublicBundleItem[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Builds the buyer-facing shape for the given active bundles, dropping any that can't be bought right now. */
export async function buildPublicBundles(bundleRows: Array<typeof productBundles.$inferSelect>): Promise<PublicBundle[]> {
  const active = bundleRows.filter((b) => b.status === "active");
  if (active.length === 0) return [];
  const items = await db.select().from(bundleItems).where(inArray(bundleItems.bundleId, active.map((b) => b.id)));
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (productIds.length === 0) return [];
  const productRows = await db.select({
    id: products.id, name: products.name, images: products.images, ownerId: products.ownerId, status: products.status,
  }).from(products).where(and(inArray(products.id, productIds), isNull(products.deletedAt)));
  const variantRows = await db.select({
    id: productVariants.id, productId: productVariants.productId, size: productVariants.size, color: productVariants.color,
    priceCents: productVariants.priceCents, stock: productVariants.stock,
  }).from(productVariants).where(inArray(productVariants.productId, productIds));
  const sellerIds = [...new Set(active.map((b) => b.ownerId))];
  const sellerRows = await db.select({ clerkId: users.clerkId, displayName: users.displayName, name: users.name })
    .from(users).where(inArray(users.clerkId, sellerIds));
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const sellerName = new Map(sellerRows.map((s) => [s.clerkId, (s.displayName?.trim() || s.name?.trim() || null)]));

  const out: PublicBundle[] = [];
  for (const bundle of active) {
    const own = items.filter((i) => i.bundleId === bundle.id && i.quantity > 0);
    if (own.length === 0) continue;
    const built: PublicBundleItem[] = [];
    let buyable = true;
    for (const item of own) {
      const product = productById.get(item.productId);
      if (!product || product.status !== "active" || product.ownerId !== bundle.ownerId) { buyable = false; break; }
      const variants = variantRows
        .filter((v) => v.productId === item.productId && (!item.variantId || v.id === item.variantId) && v.stock >= item.quantity)
        .sort((a, b) => a.priceCents - b.priceCents);
      if (variants.length === 0) { buyable = false; break; }
      const shown = variants[0];
      const images = Array.isArray(product.images) ? (product.images as string[]).filter(Boolean) : [];
      built.push({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        productName: product.name,
        image: images[0] ?? null,
        images,
        priceCents: shown.priceCents,
        size: item.variantId ? shown.size : null,
        color: item.variantId ? shown.color : null,
        variants: variants.map(({ id, size, color, priceCents, stock }) => ({ id, size, color, priceCents, stock })),
      });
    }
    if (!buyable) continue;
    const itemsTotalCents = built.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
    const savingsCents = Math.max(0, itemsTotalCents - Math.max(0, bundle.bundlePriceCents));
    if (savingsCents <= 0) continue;
    out.push({
      id: bundle.id,
      sellerId: bundle.ownerId,
      sellerName: sellerName.get(bundle.ownerId) ?? null,
      name: bundle.name,
      description: bundle.description ?? null,
      images: Array.isArray(bundle.images) ? bundle.images : [],
      bundlePriceCents: bundle.bundlePriceCents,
      itemsTotalCents,
      compareAtCents: Math.max(itemsTotalCents, bundle.compareAtCents ?? 0),
      savingsCents,
      needsSelection: built.some((i) => !i.variantId && i.variants.length > 1),
      items: built,
    });
  }
  return out;
}

export async function publicBundlesForSeller(sellerId: string): Promise<PublicBundle[]> {
  const rows = await db.select().from(productBundles)
    .where(and(eq(productBundles.ownerId, sellerId), eq(productBundles.status, "active")))
    .orderBy(desc(productBundles.createdAt)).limit(50);
  return buildPublicBundles(rows);
}

export async function publicBundlesForProduct(productId: string): Promise<PublicBundle[]> {
  if (!isUuid(productId)) return [];
  const ids = await db.selectDistinct({ id: bundleItems.bundleId }).from(bundleItems).where(eq(bundleItems.productId, productId));
  if (ids.length === 0) return [];
  const rows = await db.select().from(productBundles)
    .where(and(inArray(productBundles.id, ids.map((r) => r.id)), eq(productBundles.status, "active")))
    .orderBy(desc(productBundles.createdAt)).limit(10);
  return buildPublicBundles(rows);
}

export async function publicBundle(bundleId: string): Promise<PublicBundle | null> {
  if (!isUuid(bundleId)) return null;
  const rows = await db.select().from(productBundles).where(eq(productBundles.id, bundleId)).limit(1);
  return (await buildPublicBundles(rows))[0] ?? null;
}

// ─── Seller: bundle sales ────────────────────────────────────────────────────

export type BundleSales = {
  bundleId: string;
  name: string;
  status: string | null;
  /** Complete bundle sets sold. */
  setsSold: number;
  orderCount: number;
  /** What buyers paid for the bundle sets (sets × bundle price), before refunds. */
  grossRevenueCents: number;
  /** Same, net of refunds. */
  revenueCents: number;
  /** Savings given to buyers. */
  discountCents: number;
};

export async function bundleSalesForSeller(ownerId: string, since?: Date | null): Promise<BundleSales[]> {
  const result = await db.execute(sql`
    SELECT bl->>'bundleId' AS bundle_id,
           MAX(bl->>'name') AS name,
           COALESCE(SUM((bl->>'sets')::int), 0)::int AS sets_sold,
           COUNT(DISTINCT o.id)::int AS order_count,
           COALESCE(SUM((bl->>'itemsCents')::int - (bl->>'discountCents')::int), 0)::int AS gross_cents,
           COALESCE(SUM(ROUND(
             ((bl->>'itemsCents')::int - (bl->>'discountCents')::int)::numeric
             * GREATEST(o.total_cents - COALESCE(o.refunded_cents, 0), 0) / NULLIF(o.total_cents, 0)
           )), 0)::int AS net_cents,
           COALESCE(SUM((bl->>'discountCents')::int), 0)::int AS discount_cents
    FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.bundle_lines, '[]'::jsonb)) AS bl
    WHERE o.owner_id = ${ownerId}
      AND o.paid_at IS NOT NULL
      AND o.status != 'cancelled'
      ${since ? sql`AND o.created_at >= ${since}` : sql``}
    GROUP BY bl->>'bundleId'
    ORDER BY net_cents DESC
  `);
  const rows = (result as any).rows as Array<Record<string, any>>;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.bundle_id)).filter(isUuid);
  const current = ids.length
    ? await db.select({ id: productBundles.id, name: productBundles.name, status: productBundles.status })
      .from(productBundles).where(and(inArray(productBundles.id, ids), eq(productBundles.ownerId, ownerId)))
    : [];
  const byId = new Map(current.map((b) => [b.id, b]));
  return rows.map((r) => ({
    bundleId: String(r.bundle_id),
    name: byId.get(String(r.bundle_id))?.name ?? String(r.name ?? "Bundle"),
    status: byId.get(String(r.bundle_id))?.status ?? null,
    setsSold: Number(r.sets_sold) || 0,
    orderCount: Number(r.order_count) || 0,
    grossRevenueCents: Number(r.gross_cents) || 0,
    revenueCents: Number(r.net_cents) || 0,
    discountCents: Number(r.discount_cents) || 0,
  }));
}
