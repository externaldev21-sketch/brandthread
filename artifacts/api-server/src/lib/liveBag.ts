/**
 * The "live bag": every product a viewer can buy in a live. That is the host's
 * tagged products (live_streams.product_tags) plus the products an accepted
 * co-host added (live_cohost_products), each bought from its own seller's
 * store — the order is attributed per product, as every checkout already is.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface LiveBagProduct {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri: string | null;
  sellerId: string;
  sellerName: string;
  /** True for the host's own tagged products. */
  fromHost: boolean;
  highlighted?: boolean;
}

const MAX_BAG = 60;

/** Current name / lowest variant price / first image of active, non-deleted products. */
export async function loadProductCards(productIds: string[]): Promise<Map<string, {
  name: string; priceCents: number; imageUri: string | null; sellerId: string; sellerName: string;
}>> {
  const ids = [...new Set(productIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, MAX_BAG);
  const out = new Map<string, { name: string; priceCents: number; imageUri: string | null; sellerId: string; sellerName: string }>();
  if (!ids.length) return out;
  const rows = await db.execute(sql`
    SELECT p.id, p.name, p.images, p.owner_id,
           COALESCE(u.brand_name, u.display_name, '') AS seller_name,
           (SELECT MIN(v.price_cents) FROM product_variants v WHERE v.product_id = p.id) AS price_cents
    FROM products p
    LEFT JOIN users u ON u.clerk_id = p.owner_id
    WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      AND p.status = 'active'
      AND p.deleted_at IS NULL
  `);
  for (const r of rows.rows as any[]) {
    const images = Array.isArray(r.images) ? r.images : [];
    out.set(String(r.id), {
      name: String(r.name ?? ""),
      priceCents: Number(r.price_cents ?? 0),
      imageUri: typeof images[0] === "string" ? images[0] : null,
      sellerId: String(r.owner_id),
      sellerName: String(r.seller_name ?? ""),
    });
  }
  return out;
}

/** Host tags first (in the host's order), then co-host products. Null when the stream doesn't exist. */
export async function loadLiveBag(streamId: string): Promise<{ sellerId: string; status: string; products: LiveBagProduct[] } | null> {
  const streamRows = await db.execute(sql`
    SELECT ls.seller_id, ls.status, ls.product_tags,
           COALESCE(u.brand_name, u.display_name, '') AS seller_name
    FROM live_streams ls LEFT JOIN users u ON u.clerk_id = ls.seller_id
    WHERE ls.id = ${streamId}::uuid
  `);
  const stream = streamRows.rows[0] as any;
  if (!stream) return null;
  const hostTags: any[] = Array.isArray(stream.product_tags) ? stream.product_tags : [];
  const products: LiveBagProduct[] = hostTags
    .filter((t) => t && typeof t.productId === "string")
    .map((t) => ({
      productId: t.productId,
      productName: String(t.productName ?? ""),
      priceCents: Number(t.priceCents) || 0,
      imageUri: typeof t.imageUri === "string" ? t.imageUri : null,
      sellerId: stream.seller_id,
      sellerName: stream.seller_name,
      fromHost: true,
      ...(t.highlighted ? { highlighted: true } : {}),
    }));

  // Only co-hosts who are on stage right now contribute products.
  const cohostRows = await db.execute(sql`
    SELECT cp.product_id
    FROM live_cohost_products cp
    JOIN live_cohosts lc ON lc.stream_id = cp.stream_id AND lc.cohost_id = cp.cohost_id AND lc.status = 'accepted'
    WHERE cp.stream_id = ${streamId}::uuid
    ORDER BY cp.created_at ASC
  `);
  const cohostIds = (cohostRows.rows as any[]).map((r) => String(r.product_id));
  const cards = await loadProductCards(cohostIds);
  const seen = new Set(products.map((p) => p.productId));
  for (const id of cohostIds) {
    const card = cards.get(id);
    if (!card || seen.has(id)) continue;
    seen.add(id);
    products.push({
      productId: id, productName: card.name, priceCents: card.priceCents, imageUri: card.imageUri,
      sellerId: card.sellerId, sellerName: card.sellerName, fromHost: false,
    });
  }
  return { sellerId: stream.seller_id, status: stream.status, products: products.slice(0, MAX_BAG) };
}

/** Whether `sellerId` sells in this live: the host, or a co-host on stage. */
export async function isSellerInLive(streamId: string, sellerId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM live_streams ls
    WHERE ls.id = ${streamId}::uuid AND ls.status = 'live'
      AND (ls.seller_id = ${sellerId} OR EXISTS (
        SELECT 1 FROM live_cohosts lc
        WHERE lc.stream_id = ls.id AND lc.cohost_id = ${sellerId} AND lc.status = 'accepted'
      ))
    LIMIT 1
  `);
  return rows.rows.length > 0;
}
