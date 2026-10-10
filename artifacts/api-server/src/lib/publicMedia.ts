/**
 * Public, absolute image URLs for things people share (BT-314).
 *
 * Product photos uploaded in the app are stored as private object paths
 * ("/objects/uploads/<uuid>"). Crawlers (iMessage, WhatsApp, Instagram, X),
 * the server-rendered bio page and marketing emails all need an absolute
 * https URL, so those paths are exposed through one stable public route:
 *
 *   GET {web origin}/api/v1/public/media/products/:productId/:index
 *
 * which 302s to a short-lived signed URL, and only for an image that is
 * listed on an ACTIVE, non-deleted product (routes/public-media.ts). Images
 * that are already absolute https URLs (Shopify imports, CDN links) are
 * returned unchanged.
 */
import { getWebOrigin } from "./webOrigin";

export const MAX_PUBLIC_PRODUCT_IMAGES = 12;

export function isHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/[^\s"'<>]+$/i.test(value.trim());
}

export function isObjectPath(value: unknown): value is string {
  return typeof value === "string" && /^\/objects\/[A-Za-z0-9._\/-]{1,200}$/.test(value) && !value.includes("..");
}

/** The stable public URL for product image `index`, or null if it can't be shown publicly. */
export function publicProductImageUrl(productId: string, index: number, raw: unknown): string | null {
  if (isHttpsUrl(raw)) return raw.trim();
  if (!isObjectPath(raw) || !Number.isInteger(index) || index < 0 || index >= MAX_PUBLIC_PRODUCT_IMAGES) return null;
  return `${getWebOrigin()}/api/v1/public/media/products/${encodeURIComponent(productId)}/${index}`;
}

/** The first product image as a public absolute URL, or null. */
export function publicProductCoverUrl(productId: string, images: unknown): string | null {
  const list = Array.isArray(images) ? images : [];
  for (let i = 0; i < Math.min(list.length, MAX_PUBLIC_PRODUCT_IMAGES); i++) {
    const url = publicProductImageUrl(productId, i, list[i]);
    if (url) return url;
  }
  return null;
}
