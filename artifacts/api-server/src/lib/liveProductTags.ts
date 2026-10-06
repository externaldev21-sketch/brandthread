/**
 * Products a seller features in a Live, resolved on the SERVER.
 *
 * Hosts send `{ productId, highlighted? }` (older clients also send a name
 * and a price they made up — `priceCents: 0`, since the seller product list
 * carries no price). Viewers see these tags as purchase cards, so the name,
 * price and image must come from the seller's own catalogue, never from the
 * request: only active, non-deleted products owned by the host are kept,
 * priced from their cheapest in-stock variant (cheapest variant overall when
 * everything is sold out).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, products, productVariants } from "@workspace/db";

export const MAX_LIVE_PRODUCT_TAGS = 50;

export type LiveProductTag = {
  productId: string;
  productName: string;
  priceCents: number;
  imageUrl: string | null;
  inStock: boolean;
  highlighted: boolean;
};

export class LiveProductTagError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type RequestedTag = { productId: string; highlighted: boolean };

function parseRequested(raw: unknown): RequestedTag[] {
  if (!Array.isArray(raw)) throw new LiveProductTagError("productTags must be an array");
  const seen = new Set<string>();
  const out: RequestedTag[] = [];
  for (const item of raw) {
    const productId = typeof item === "string" ? item : (item as any)?.productId;
    if (typeof productId !== "string" || !productId || seen.has(productId)) continue;
    seen.add(productId);
    out.push({ productId, highlighted: Boolean((item as any)?.highlighted) });
  }
  if (out.length > MAX_LIVE_PRODUCT_TAGS) {
    throw new LiveProductTagError(`You can feature up to ${MAX_LIVE_PRODUCT_TAGS} products in a live.`);
  }
  return out;
}

export async function resolveLiveProductTags(sellerId: string, raw: unknown): Promise<LiveProductTag[]> {
  const requested = parseRequested(raw ?? []);
  if (requested.length === 0) return [];
  const uuidLike = requested.filter((r) => /^[0-9a-f-]{36}$/i.test(r.productId));
  if (uuidLike.length === 0) return [];

  const rows = await db
    .select({ id: products.id, name: products.name, images: products.images })
    .from(products)
    .where(and(
      inArray(products.id, uuidLike.map((r) => r.productId)),
      eq(products.ownerId, sellerId),
      eq(products.status, "active"),
      isNull(products.deletedAt),
    ));
  if (rows.length === 0) return [];

  const variants = await db
    .select({ productId: productVariants.productId, priceCents: productVariants.priceCents, stock: productVariants.stock })
    .from(productVariants)
    .where(inArray(productVariants.productId, rows.map((r) => r.id)));

  const byId = new Map(rows.map((r) => [r.id, r]));
  // Only one product can be the highlighted "now showing" card.
  let highlightTaken = false;
  const tags: LiveProductTag[] = [];
  for (const req of requested) {
    const product = byId.get(req.productId);
    if (!product) continue;
    const own = variants.filter((v) => v.productId === product.id);
    if (own.length === 0) continue; // nothing buyable
    const inStock = own.filter((v) => v.stock > 0);
    const pool = inStock.length > 0 ? inStock : own;
    const priceCents = Math.min(...pool.map((v) => v.priceCents));
    const highlighted = req.highlighted && !highlightTaken;
    if (highlighted) highlightTaken = true;
    tags.push({
      productId: product.id,
      productName: product.name,
      priceCents,
      imageUrl: Array.isArray(product.images) && typeof product.images[0] === "string" ? product.images[0] : null,
      inStock: inStock.length > 0,
      highlighted,
    });
  }
  return tags;
}
