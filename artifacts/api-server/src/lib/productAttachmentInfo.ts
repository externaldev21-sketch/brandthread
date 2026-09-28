/**
 * Live product info for 'product' message attachments (chat product cards —
 * item 70). A product card's title/price/image are cached on the message
 * attachment at send time (see routes/conversations.ts), which would go
 * stale the moment a seller edits the price or the product is archived/
 * deleted. This module re-resolves the CURRENT product state for every
 * 'product' attachment on every read, the same way
 * lib/savedProductBadges.ts keeps the Saved feed's price/stock badges live.
 *
 * Unlike savedProductBadges, this also has to distinguish "still exists but
 * inactive" from "gone entirely" — a deleted/archived product must render an
 * honest "No longer available" state in the chat bubble instead of a stale
 * price, per the product-detail screen's own "Product not found" fallback.
 */
import { inArray } from "drizzle-orm";
import { db, products, productVariants } from "@workspace/db";

export interface ProductAttachmentInfo {
  available: boolean;
  name: string;
  image: string | null;
  priceCents: number | null;
}

function formatCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/** Fetch live name/image/price/availability for a set of product IDs. */
export async function fetchProductAttachmentInfo(productIds: string[]): Promise<Map<string, ProductAttachmentInfo>> {
  const result = new Map<string, ProductAttachmentInfo>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const [productRows, variantRows] = await Promise.all([
    db.select({
      id: products.id,
      name: products.name,
      images: products.images,
      status: products.status,
      deletedAt: products.deletedAt,
    }).from(products).where(inArray(products.id, ids)),
    db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents })
      .from(productVariants)
      .where(inArray(productVariants.productId, ids)),
  ]);

  const pricesByProduct = new Map<string, number[]>();
  for (const v of variantRows) {
    const list = pricesByProduct.get(v.productId) ?? [];
    list.push(v.priceCents);
    pricesByProduct.set(v.productId, list);
  }

  for (const p of productRows) {
    const prices = pricesByProduct.get(p.id) ?? [];
    const images = Array.isArray(p.images) ? p.images.filter((i): i is string => typeof i === "string") : [];
    result.set(p.id, {
      available: p.status === "active" && !p.deletedAt,
      name: p.name,
      image: images[0] ?? null,
      priceCents: prices.length ? Math.min(...prices) : null,
    });
  }
  // Products missing from productRows entirely (hard-deleted / bad id) are
  // simply absent from the map — callers treat "not in map" the same as
  // available: false.

  return result;
}

/** Mutates a single 'product' MessageAttachment-shaped object in place, if
 *  present, replacing its cached title/subtitle/uri with live data — or an
 *  honest "no longer available" state when the product is gone/inactive. */
export function applyProductAttachmentInfo(attachment: any, infoByProductId: Map<string, ProductAttachmentInfo>): void {
  if (!attachment || typeof attachment !== "object" || attachment.type !== "product") return;
  const productId = attachment.meta?.productId;
  if (!productId) return;
  const info = infoByProductId.get(productId);
  attachment.meta = { ...(attachment.meta ?? {}), productId };
  if (!info || !info.available) {
    // Keep the last-known name for context, but never a stale price.
    attachment.meta.unavailable = "true";
    attachment.subtitle = "No longer available";
    if (info?.name) attachment.title = info.name;
    return;
  }
  delete attachment.meta.unavailable;
  attachment.title = info.name;
  attachment.uri = info.image ?? attachment.uri;
  attachment.subtitle = info.priceCents != null ? formatCents(info.priceCents) : "Product";
  attachment.meta.priceCents = info.priceCents != null ? String(info.priceCents) : undefined;
}

/** Collects every 'product' attachment's productId across a page of adapted
 *  messages (checks both the primary `attachment` and the `attachments`
 *  array), fetches live info once, and enriches every one of them in place. */
export async function enrichProductAttachments(adaptedMessages: { attachment?: any; attachments?: any[] }[]): Promise<void> {
  const productIds: string[] = [];
  for (const m of adaptedMessages) {
    if (m.attachment?.type === "product" && m.attachment.meta?.productId) productIds.push(m.attachment.meta.productId);
    for (const a of m.attachments ?? []) {
      if (a?.type === "product" && a.meta?.productId) productIds.push(a.meta.productId);
    }
  }
  if (productIds.length === 0) return;
  const infoByProductId = await fetchProductAttachmentInfo(productIds);
  for (const m of adaptedMessages) {
    if (m.attachment) applyProductAttachmentInfo(m.attachment, infoByProductId);
    for (const a of m.attachments ?? []) applyProductAttachmentInfo(a, infoByProductId);
  }
}
