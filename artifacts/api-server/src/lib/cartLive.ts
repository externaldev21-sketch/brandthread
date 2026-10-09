/**
 * Live catalog fields for persisted bag lines.
 *
 * cart_items.item_data is the client's snapshot from add-to-cart time. The bag
 * needs the seller's *current* price and stock so a price edit or a sell-out
 * shows up before checkout. This joins every line against products /
 * product_variants in two batched queries (never one per line) and reports:
 *
 *   live: { priceCents, compareAtPriceCents, stock, available, reason, priceChanged }
 *
 * `priceCents` is the price the buyer would be charged now — the automatic
 * sale price when one is live (same rule as checkout and the product page).
 * `available` mirrors the checkout validator: the product exists, is not
 * deleted, is `active`, and the variant has stock. A line whose variant is
 * gone but whose product still exists (a "product-level" line) falls back to
 * the product's variants: total stock, cheapest price.
 */
import { db, products, productVariants } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { applySalesToVariants } from "./pricing/salesRuntime";
import { isProductAvailable } from "./productVisibility";

export type CartLiveReason = "out_of_stock" | "unavailable" | null;

export interface CartLiveFields {
  priceCents: number;
  compareAtPriceCents: number | null;
  stock: number;
  available: boolean;
  reason: CartLiveReason;
  priceChanged: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);

type ProductRow = { id: string; ownerId: string; status: string; deletedAt: Date | null; category: string | null; tags: unknown };
type VariantRow = { id: string; productId: string; priceCents: number; compareAtPriceCents: number | null; stock: number };

/** Pure: decide one line's live fields from what the catalog holds now. */
export function computeCartLive(
  item: { variantId?: unknown; productId?: unknown; priceCents?: unknown },
  variantsById: ReadonlyMap<string, VariantRow>,
  variantsByProduct: ReadonlyMap<string, VariantRow[]>,
  productsById: ReadonlyMap<string, ProductRow>,
): CartLiveFields {
  const snapshotPrice = typeof item.priceCents === "number" && Number.isSafeInteger(item.priceCents) ? item.priceCents : null;
  const variantId = asUuid(item.variantId);
  const itemProductId = asUuid(item.productId);
  let variant = variantId ? variantsById.get(variantId) : undefined;
  // A variant that belongs to a different product than the line claims is not this line's variant.
  if (variant && itemProductId && variant.productId !== itemProductId) variant = undefined;
  const productId = variant?.productId ?? itemProductId;
  const product = productId ? productsById.get(productId) : undefined;

  const gone = (): CartLiveFields => ({
    priceCents: snapshotPrice ?? 0, compareAtPriceCents: null, stock: 0,
    available: false, reason: "unavailable", priceChanged: false,
  });
  if (!product || !isProductAvailable(product)) return gone();

  let priceCents: number;
  let compareAtPriceCents: number | null;
  let stock: number;
  if (variant) {
    priceCents = variant.priceCents;
    compareAtPriceCents = variant.compareAtPriceCents ?? null;
    stock = Math.max(0, variant.stock);
  } else {
    // Product-level line: the product's own variants decide.
    const siblings = variantsByProduct.get(product.id) ?? [];
    if (siblings.length === 0) return gone();
    const cheapest = siblings.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
    priceCents = cheapest.priceCents;
    compareAtPriceCents = cheapest.compareAtPriceCents ?? null;
    stock = siblings.reduce((s, v) => s + Math.max(0, v.stock), 0);
  }
  const available = stock > 0;
  return {
    priceCents, compareAtPriceCents, stock, available,
    reason: available ? null : "out_of_stock",
    priceChanged: snapshotPrice !== null && snapshotPrice !== priceCents,
  };
}

/** Batched: live fields for every line, in input order. Never throws for bad ids. */
export async function loadCartLiveFields(
  items: ReadonlyArray<{ variantId?: unknown; productId?: unknown; priceCents?: unknown }>,
): Promise<CartLiveFields[]> {
  if (items.length === 0) return [];
  const variantIds = [...new Set(items.map((i) => asUuid(i.variantId)).filter((v): v is string => !!v))];
  const directVariants: VariantRow[] = variantIds.length
    ? await db.select({
        id: productVariants.id, productId: productVariants.productId, priceCents: productVariants.priceCents,
        compareAtPriceCents: productVariants.compareAtPriceCents, stock: productVariants.stock,
      }).from(productVariants).where(inArray(productVariants.id, variantIds))
    : [];
  const foundVariantIds = new Set(directVariants.map((v) => v.id));
  const productIds = new Set<string>(directVariants.map((v) => v.productId));
  // Lines whose variant is missing fall back to their product's variants.
  const fallbackProductIds = new Set<string>();
  for (const i of items) {
    const vid = asUuid(i.variantId);
    const pid = asUuid(i.productId);
    if (pid) productIds.add(pid);
    if (pid && (!vid || !foundVariantIds.has(vid))) fallbackProductIds.add(pid);
  }
  const productRows: ProductRow[] = productIds.size
    ? await db.select({
        id: products.id, ownerId: products.ownerId, status: products.status, deletedAt: products.deletedAt,
        category: products.category, tags: products.tags,
      }).from(products).where(inArray(products.id, [...productIds]))
    : [];
  const siblingVariants: VariantRow[] = fallbackProductIds.size
    ? await db.select({
        id: productVariants.id, productId: productVariants.productId, priceCents: productVariants.priceCents,
        compareAtPriceCents: productVariants.compareAtPriceCents, stock: productVariants.stock,
      }).from(productVariants).where(inArray(productVariants.productId, [...fallbackProductIds]))
    : [];

  // Charged price = automatic sale price when live (fails open to catalog price).
  const uniqueVariants = [...new Map([...directVariants, ...siblingVariants].map((v) => [v.id, v])).values()];
  const priced = await applySalesToVariants(productRows, uniqueVariants);
  const variantsById = new Map<string, VariantRow>();
  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of priced) {
    variantsById.set(v.id, v);
    (variantsByProduct.get(v.productId) ?? variantsByProduct.set(v.productId, []).get(v.productId)!).push(v);
  }
  const productsById = new Map(productRows.map((p) => [p.id, p]));
  return items.map((i) => computeCartLive(i, variantsById, variantsByProduct, productsById));
}
