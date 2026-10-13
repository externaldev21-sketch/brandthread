/**
 * Product catalog feeds for Meta Commerce Manager (Facebook / Instagram
 * Shopping data feeds) and TikTok catalogs. Pure functions: rows in, CSV out.
 *
 * One row per variant; variants of a product share item_group_id = product id.
 * Only public fields are read. A variant's SKU, stock count, cost, weight and
 * anything seller-private never appear: the feed id is the variant UUID and
 * stock only decides "in stock" / "out of stock".
 *
 * TikTok: TikTok Shop listings are created through the TikTok Shop Partner
 * API (or Seller Center uploads), not a scheduled feed URL. A URL feed is what
 * a TikTok Ads catalog (Catalog Manager > Data feed schedule) accepts, so the
 * TikTok file follows the TikTok catalog template: sku_id instead of id.
 */
import { toCSV } from "../../routes/seller-export"; // formula-injection-safe CSV
import { classifyProduct } from "../categoryTaxonomy";
import { rewriteToCdn } from "../cdnUrl";

export type FeedPlatform = "meta" | "tiktok";

export type FeedProduct = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: unknown;
  images: unknown;
  isPreOrder: boolean;
};

export type FeedVariant = {
  id: string;
  productId: string;
  size: string | null;
  color: string | null;
  /** Effective (sale-applied) price the buyer pays. */
  priceCents: number;
  /** "Was" price; when above priceCents the row gets a sale_price. */
  compareAtPriceCents: number | null;
  stock: number;
};

export type FeedItem = {
  id: string;
  itemGroupId: string;
  title: string;
  description: string;
  availability: "in stock" | "out of stock" | "preorder";
  condition: "new";
  price: string;
  salePrice: string;
  link: string;
  imageLink: string;
  additionalImageLink: string;
  brand: string;
  googleProductCategory: string;
  size: string;
  color: string;
};

const TITLE_MAX = 150; // TikTok's limit; Meta allows 200
const DESCRIPTION_MAX = 5000;
const MAX_ADDITIONAL_IMAGES = 9;

/** Integer cents to the "12.00 USD" form both platforms accept. No floats. */
export function formatFeedPrice(cents: number, currency = "USD"): string {
  const c = Math.max(0, Math.trunc(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")} ${currency}`;
}

/** Google product taxonomy paths (accepted by Meta and TikTok as text). */
const GOOGLE_CATEGORY: Record<string, string> = {
  hoodies: "Apparel & Accessories > Clothing > Shirts & Tops",
  tees: "Apparel & Accessories > Clothing > Shirts & Tops",
  knitwear: "Apparel & Accessories > Clothing > Shirts & Tops",
  jackets: "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets",
  denim: "Apparel & Accessories > Clothing > Pants",
  pants: "Apparel & Accessories > Clothing > Pants",
  shorts: "Apparel & Accessories > Clothing > Shorts",
  dresses: "Apparel & Accessories > Clothing > Dresses",
  footwear: "Apparel & Accessories > Shoes",
  accessories: "Apparel & Accessories > Clothing Accessories",
};

export function googleCategoryFor(p: Pick<FeedProduct, "category" | "name" | "tags">): string {
  const slug = classifyProduct({ category: p.category, name: p.name, tags: p.tags });
  return (slug && GOOGLE_CATEGORY[slug]) || "Apparel & Accessories > Clothing";
}

/** Absolute http(s) image URLs only (relative paths resolve against the web origin). */
export function absoluteImages(images: unknown, origin: string): string[] {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const raw of images) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (/^https?:\/\//i.test(v)) out.push(rewriteToCdn(v));
    else if (v.startsWith("/") && !v.startsWith("//")) out.push(`${origin}${v}`);
  }
  return out;
}

/** Collapse whitespace and control characters a feed parser would choke on. */
function clean(text: string | null | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex
  const v = (text ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
}

export function buildFeedItems(input: {
  products: FeedProduct[];
  variants: FeedVariant[];
  brand: string;
  origin: string;
}): FeedItem[] {
  const byProduct = new Map<string, FeedVariant[]>();
  for (const v of input.variants) {
    const list = byProduct.get(v.productId) ?? [];
    list.push(v);
    byProduct.set(v.productId, list);
  }
  const brand = clean(input.brand, 100) || "Brandthread";
  const items: FeedItem[] = [];
  for (const p of input.products) {
    const variants = byProduct.get(p.id) ?? [];
    const images = absoluteImages(p.images, input.origin);
    // Both platforms reject an item without a price or an image.
    if (variants.length === 0 || images.length === 0) continue;
    const title = clean(p.name, TITLE_MAX);
    if (!title) continue;
    const description = clean(p.description, DESCRIPTION_MAX) || title;
    const category = googleCategoryFor(p);
    for (const v of variants) {
      if (!Number.isSafeInteger(v.priceCents) || v.priceCents <= 0) continue;
      const onSale = v.compareAtPriceCents != null && v.compareAtPriceCents > v.priceCents;
      items.push({
        id: v.id,
        itemGroupId: p.id,
        title,
        description,
        availability: p.isPreOrder ? "preorder" : v.stock > 0 ? "in stock" : "out of stock",
        condition: "new",
        price: formatFeedPrice(onSale ? v.compareAtPriceCents! : v.priceCents),
        salePrice: onSale ? formatFeedPrice(v.priceCents) : "",
        link: `${input.origin}/store/product/${p.id}`,
        imageLink: images[0],
        additionalImageLink: images.slice(1, 1 + MAX_ADDITIONAL_IMAGES).join(","),
        brand,
        googleProductCategory: category,
        size: clean(v.size, 100),
        color: clean(v.color, 100),
      });
    }
  }
  return items;
}

/** Meta Commerce Manager data feed columns (required first, then optional). */
export const META_COLUMNS = [
  "id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand",
  "additional_image_link", "item_group_id", "sale_price", "google_product_category", "size", "color",
] as const;

/** TikTok catalog template columns (required first, then optional). */
export const TIKTOK_COLUMNS = [
  "sku_id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand",
  "additional_image_link", "item_group_id", "sale_price", "google_product_category", "size", "color",
] as const;

function toRow(item: FeedItem, idColumn: "id" | "sku_id"): Record<string, string> {
  return {
    [idColumn]: item.id,
    title: item.title,
    description: item.description,
    availability: item.availability,
    condition: item.condition,
    price: item.price,
    link: item.link,
    image_link: item.imageLink,
    brand: item.brand,
    additional_image_link: item.additionalImageLink,
    item_group_id: item.itemGroupId,
    sale_price: item.salePrice,
    google_product_category: item.googleProductCategory,
    size: item.size,
    color: item.color,
  };
}

export function feedCsv(platform: FeedPlatform, items: FeedItem[]): string {
  const idColumn = platform === "tiktok" ? "sku_id" : "id";
  const columns = platform === "tiktok" ? TIKTOK_COLUMNS : META_COLUMNS;
  return `${toCSV(items.map((i) => toRow(i, idColumn)), [...columns])}\n`;
}
