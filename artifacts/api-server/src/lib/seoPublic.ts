/**
 * Pure helpers for the public SEO surfaces (product structured data, the
 * "New this week" page and the sitemap). No DB access, so the rules that
 * decide what a crawler is told are unit-testable on their own.
 */

/** Rolling window for brandthread.app/new. */
export const NEW_THIS_WEEK_DAYS = 7;
/** Page size + absolute cap for the "New this week" listing. */
export const NEW_THIS_WEEK_PAGE_MAX = 48;
export const NEW_THIS_WEEK_TOTAL_CAP = 480;
/** Per-sitemap URL cap (the protocol allows 50,000; keep responses small). */
export const SITEMAP_KIND_CAP = 5000;
export const SITEMAP_KINDS = ["products", "stores", "drops"] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];

export type SchemaAvailability = "InStock" | "OutOfStock" | "PreOrder";

/** First absolute http(s) URL: crawlers cannot resolve app-relative object paths. */
export function absoluteHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : null;
}

export function absoluteImages(values: unknown, max = 10): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const url = absoluteHttpUrl(v);
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

export function clipText(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The public brand shown for a product: the seller's published store name,
 * else their brand name, else their public display name.
 */
export function publicBrandName(input: {
  storeTitle?: string | null;
  storePublished?: boolean | null;
  brandName?: string | null;
  displayName?: string | null;
}): string | null {
  const pick = [input.storePublished ? input.storeTitle : null, input.brandName, input.displayName]
    .map((v) => (v ?? "").trim())
    .find((v) => v.length > 0);
  return pick ? pick.slice(0, 120) : null;
}

/**
 * Real buyability, mapped to schema.org ItemAvailability:
 * - not launched yet / seller on vacation → OutOfStock (cannot be bought now)
 * - pre-order product → PreOrder
 * - any variant with stock → InStock, else OutOfStock
 */
export function schemaAvailability(input: {
  live: boolean;
  vacation: boolean;
  isPreOrder: boolean;
  totalStock: number;
}): SchemaAvailability {
  if (!input.live || input.vacation) return "OutOfStock";
  if (input.isPreOrder) return "PreOrder";
  return input.totalStock > 0 ? "InStock" : "OutOfStock";
}

/** Integer cents → schema.org decimal string ("45.00"), without float math. */
export function centsToDecimalString(cents: number): string {
  const safe = Math.max(0, Math.trunc(cents));
  const whole = Math.floor(safe / 100);
  const rest = safe % 100;
  return `${whole}.${rest < 10 ? `0${rest}` : rest}`;
}

export interface PriceSummary {
  lowCents: number;
  highCents: number;
  /** Struck-through "was" price for the lowest-priced variant, when higher. */
  compareAtCents: number | null;
  offerCount: number;
}

export function summarizePrices(
  variants: ReadonlyArray<{ priceCents: number | null | undefined; compareAtPriceCents?: number | null }>,
): PriceSummary | null {
  const priced = variants.filter(
    (v): v is { priceCents: number; compareAtPriceCents?: number | null } =>
      typeof v.priceCents === "number" && Number.isSafeInteger(v.priceCents) && v.priceCents >= 0,
  );
  if (priced.length === 0) return null;
  let low = priced[0];
  let highCents = priced[0].priceCents;
  for (const v of priced) {
    if (v.priceCents < low.priceCents) low = v;
    if (v.priceCents > highCents) highCents = v.priceCents;
  }
  const compare = low.compareAtPriceCents;
  return {
    lowCents: low.priceCents,
    highCents,
    compareAtCents: typeof compare === "number" && compare > low.priceCents ? compare : null,
    offerCount: priced.length,
  };
}

/** When a product became publicly visible: its launch moment when scheduled, else creation. */
export function publishedAtFor(createdAt: Date, launch: { launchAt: Date; launchedAt: Date | null } | null): Date {
  if (!launch) return createdAt;
  return launch.launchedAt ?? launch.launchAt;
}

export function parseNonNegativeInt(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n > max ? max : n;
}
