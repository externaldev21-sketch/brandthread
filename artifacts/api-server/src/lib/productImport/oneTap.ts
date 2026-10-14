/**
 * One-tap import for new sellers: map a public Shopify catalog
 * (/products.json, no app keys) or the seller's own Instagram posts (existing
 * Meta connection) into ImportProducts for the normal preview → commit path.
 * Commit always creates drafts, so nothing goes live until the seller reviews
 * and publishes it. Pure — fetching lives in the route.
 */
import { MAX_VARIANTS_PER_PRODUCT, type ImportProduct, type ImportVariant, type Issue } from "./types";
import { cleanTags, sanitizeImages, stripHtml } from "./util";
import { ShopifyImportError, toBrandthreadProduct, type ShopifyProduct } from "../shopifyImport";

function shopKey(storeUrl: string): string {
  try { return new URL(storeUrl).hostname.toLowerCase(); } catch { return storeUrl.toLowerCase(); }
}

function compareAtCents(raw: unknown, priceCents: number): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents > priceCents ? cents : null;
}

/** Maps a public Shopify storefront's products.json page. */
export function mapShopifyCatalog(storeUrl: string, list: ShopifyProduct[]): { products: ImportProduct[]; issues: Issue[] } {
  const products: ImportProduct[] = [];
  const issues: Issue[] = [];
  const host = shopKey(storeUrl);
  list.forEach((raw, index) => {
    const line = index + 1;
    const label = String(raw.title ?? "").trim() || `Product ${raw.id ?? line}`;
    let mapped: ReturnType<typeof toBrandthreadProduct>;
    try {
      mapped = toBrandthreadProduct(raw);
    } catch (err) {
      const message = err instanceof ShopifyImportError ? err.message : "Could not read this product.";
      issues.push({ severity: "error", line, product: label, field: null, message });
      return;
    }
    const variants: ImportVariant[] = mapped.variants.map((v, i) => ({
      // Shopify's own SKU when it has one; generated SKUs are left blank so commit assigns ours.
      sku: v.sku.startsWith("SHOPIFY-") ? "" : v.sku,
      size: v.size ?? null,
      color: v.color ?? null,
      priceCents: v.priceCents,
      compareAtCents: compareAtCents((raw.variants?.[i] as { compare_at_price?: unknown } | undefined)?.compare_at_price, v.priceCents),
      stock: v.stock,
      weightGrams: null,
    }));
    if (variants.length > MAX_VARIANTS_PER_PRODUCT) {
      issues.push({ severity: "warning", line, product: label, field: "variants", message: `${variants.length} variants found; only the first ${MAX_VARIANTS_PER_PRODUCT} were kept.` });
      variants.length = MAX_VARIANTS_PER_PRODUCT;
    }
    const { images, rejected } = sanitizeImages(mapped.images);
    if (rejected > 0) issues.push({ severity: "warning", line, product: label, field: "images", message: `${rejected} image link(s) skipped.` });
    products.push({
      externalKey: `shopify:${host}:${mapped.sourceProductId}`,
      name: mapped.name.slice(0, 200),
      description: mapped.description,
      category: mapped.category || "apparel",
      tags: cleanTags(mapped.tags.filter((t) => !t.startsWith("option:"))),
      images,
      vendor: null, seoTitle: null, seoDescription: null,
      sourceStatus: null,
      variants,
      lines: [line],
    });
  });
  return { products, issues };
}

export type InstagramMedia = {
  id: string;
  caption?: string | null;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_url?: string | null;
  timestamp?: string | null;
  children?: { data?: Array<{ media_type?: string; media_url?: string | null }> } | null;
};

/** First caption line without hashtags/mentions, trimmed to a product-name length. */
export function nameFromCaption(caption: string | null | undefined): string | null {
  const first = String(caption ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const clean = first.replace(/(^|\s)[#@][\p{L}\p{N}_.]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean;
}

function hashtags(caption: string | null | undefined): string[] {
  return [...String(caption ?? "").matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => m[1]!.toLowerCase());
}

/**
 * Maps the seller's Instagram photo posts to drafts: one product per photo or
 * carousel, photos only (videos are skipped). Instagram has no prices, so each
 * draft gets one $0 variant and a warning — the seller sets the price before
 * publishing (drafts never reach buyers).
 */
export function mapInstagramMedia(media: InstagramMedia[]): { products: ImportProduct[]; issues: Issue[] } {
  const products: ImportProduct[] = [];
  const issues: Issue[] = [];
  media.forEach((m, index) => {
    const line = index + 1;
    const urls = m.media_type === "CAROUSEL_ALBUM"
      ? (m.children?.data ?? []).filter((c) => c.media_type === "IMAGE").map((c) => c.media_url ?? "")
      : m.media_type === "IMAGE" ? [m.media_url ?? ""] : [];
    const { images } = sanitizeImages(urls);
    if (!images.length) return; // videos and broken posts are simply not offered
    const date = m.timestamp ? new Date(m.timestamp) : null;
    const name = nameFromCaption(m.caption)
      ?? `Instagram post${date && !Number.isNaN(date.getTime()) ? ` ${date.toISOString().slice(0, 10)}` : ""}`;
    issues.push({ severity: "warning", line, product: name, field: "price", message: "Add a price before publishing." });
    products.push({
      externalKey: `instagram:${m.id}`,
      name,
      description: stripHtml(m.caption ?? ""),
      category: "apparel",
      tags: cleanTags(hashtags(m.caption)),
      images,
      vendor: null, seoTitle: null, seoDescription: null,
      sourceStatus: null,
      variants: [{ sku: "", size: null, color: null, priceCents: 0, compareAtCents: null, stock: 0, weightGrams: null }],
      lines: [line],
    });
  });
  return { products, issues };
}
