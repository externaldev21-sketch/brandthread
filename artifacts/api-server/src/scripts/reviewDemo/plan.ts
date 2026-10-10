/**
 * Pure planning logic for the App Review demo accounts. No I/O: everything
 * here is deterministic so it can be unit-tested and so --dry-run can print
 * exactly what the seed would write. The runner is
 * artifacts/api-server/scripts/seedReviewAccounts.ts.
 */
import { TEST_EMAIL_TLD_PATTERN } from "@workspace/db/testing";

export const DEMO_BRAND_NAME = "Atelier Demo";
export const DEMO_SELLER_USERNAME = "atelier_demo";
export const DEMO_BUYER_USERNAME = "review_buyer";
/** Stable prefix for SKUs/order numbers so reruns find their own rows. */
export const DEMO_PREFIX = "RVW";

export interface DemoEnv {
  buyerEmail: string;
  buyerPassword: string;
  sellerEmail: string;
  sellerPassword: string;
  assetBaseUrl: string | null;
}

export interface EnvResult {
  ok: boolean;
  env?: DemoEnv;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 12;

/** Reads + validates credentials from env. Secrets are never defaulted. */
export function readDemoEnv(source: Record<string, string | undefined>): EnvResult {
  const errors: string[] = [];
  const get = (k: string) => (source[k] ?? "").trim();
  const buyerEmail = get("REVIEW_DEMO_BUYER_EMAIL").toLowerCase();
  const sellerEmail = get("REVIEW_DEMO_SELLER_EMAIL").toLowerCase();
  const buyerPassword = source.REVIEW_DEMO_BUYER_PASSWORD ?? "";
  const sellerPassword = source.REVIEW_DEMO_SELLER_PASSWORD ?? "";

  for (const [key, email] of [
    ["REVIEW_DEMO_BUYER_EMAIL", buyerEmail],
    ["REVIEW_DEMO_SELLER_EMAIL", sellerEmail],
  ] as const) {
    if (!email) errors.push(`${key} is required`);
    else if (!EMAIL_RE.test(email)) errors.push(`${key} is not a valid email address`);
    else if (new RegExp(TEST_EMAIL_TLD_PATTERN, "i").test(email)) {
      errors.push(`${key} must be a real, deliverable address (reserved test TLDs are swept by db:purge-test-data)`);
    }
  }
  if (buyerEmail && buyerEmail === sellerEmail) errors.push("buyer and seller emails must differ");
  for (const [key, pw] of [
    ["REVIEW_DEMO_BUYER_PASSWORD", buyerPassword],
    ["REVIEW_DEMO_SELLER_PASSWORD", sellerPassword],
  ] as const) {
    if (!pw) errors.push(`${key} is required`);
    else if (pw.length < MIN_PASSWORD) errors.push(`${key} must be at least ${MIN_PASSWORD} characters`);
  }
  const base = get("REVIEW_DEMO_ASSET_BASE_URL").replace(/\/+$/, "");
  if (base && !/^https:\/\//i.test(base)) errors.push("REVIEW_DEMO_ASSET_BASE_URL must be an https:// URL");

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    env: { buyerEmail, buyerPassword, sellerEmail, sellerPassword, assetBaseUrl: base || null },
  };
}

export interface CliFlags {
  dryRun: boolean;
  confirmProduction: boolean;
}

export function parseFlags(argv: string[]): CliFlags {
  return { dryRun: argv.includes("--dry-run"), confirmProduction: argv.includes("--confirm-production") };
}

/** A real write requires --confirm-production; --dry-run never writes. */
export function checkRunGuard(flags: CliFlags): { mode: "dry-run" | "write" } | { error: string } {
  if (flags.dryRun) return { mode: "dry-run" };
  if (!flags.confirmProduction) {
    return { error: "Refusing to write: pass --confirm-production (or --dry-run to preview)." };
  }
  return { mode: "write" };
}

// ── Catalogue ──────────────────────────────────────────────────────────────

export interface DemoVariant {
  sku: string;
  size: string | null;
  color: string | null;
  priceCents: number;
  stock: number;
}
export interface DemoProduct {
  key: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  images: string[];
  variants: DemoVariant[];
}

interface ProductSeed {
  key: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  priceCents: number;
  sizes?: string[];
  colors?: string[];
}

const PRODUCT_SEEDS: ProductSeed[] = [
  { key: "tee", name: "Heavyweight Tee", description: "240gsm organic cotton tee with a boxy fit.", category: "apparel", tags: ["tee", "basics"], priceCents: 4200, sizes: ["S", "M", "L", "XL"], colors: ["Black", "White"] },
  { key: "hoodie", name: "Everyday Hoodie", description: "Brushed-back fleece hoodie, garment dyed.", category: "apparel", tags: ["hoodie", "fleece"], priceCents: 8800, sizes: ["S", "M", "L"], colors: ["Charcoal"] },
  { key: "crew", name: "Studio Crewneck", description: "Mid-weight crewneck sweatshirt.", category: "apparel", tags: ["crewneck"], priceCents: 7200, sizes: ["M", "L"], colors: ["Stone", "Black"] },
  { key: "cap", name: "Logo Cap", description: "Unstructured six-panel cap with embroidered mark.", category: "accessories", tags: ["cap", "hat"], priceCents: 3200, colors: ["Black", "Silver"] },
  { key: "tote", name: "Canvas Tote", description: "Heavy canvas tote with reinforced handles.", category: "accessories", tags: ["tote", "bag"], priceCents: 2800, colors: ["Natural"] },
  { key: "shorts", name: "Training Shorts", description: "Lightweight shorts with zip pocket.", category: "apparel", tags: ["shorts"], priceCents: 5400, sizes: ["S", "M", "L"], colors: ["Black"] },
  { key: "socks", name: "Crew Socks (3 pack)", description: "Cushioned cotton-blend crew socks.", category: "accessories", tags: ["socks"], priceCents: 1800, sizes: ["One size"], colors: ["White"] },
  { key: "jacket", name: "Coach Jacket", description: "Water-resistant snap-front coach jacket.", category: "apparel", tags: ["jacket", "outerwear"], priceCents: 12800, sizes: ["M", "L", "XL"], colors: ["Black"] },
  { key: "beanie", name: "Rib Beanie", description: "Soft rib-knit beanie.", category: "accessories", tags: ["beanie"], priceCents: 2400, colors: ["Grey"] },
  { key: "poster", name: "Lookbook Print", description: "A3 giclee print of the season lookbook.", category: "art", tags: ["print", "poster"], priceCents: 3600 },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Image URL for an asset. Defaults to a public placeholder service. */
export function imageUrl(assetBaseUrl: string | null, name: string, w: number, h: number): string {
  const s = slug(name);
  return assetBaseUrl ? `${assetBaseUrl}/${s}.jpg` : `https://picsum.photos/seed/bt-${s}/${w}/${h}`;
}

export function buildProducts(assetBaseUrl: string | null): DemoProduct[] {
  return PRODUCT_SEEDS.map((p) => {
    const sizes: (string | null)[] = p.sizes ?? [null];
    const colors: (string | null)[] = p.colors ?? [null];
    const variants: DemoVariant[] = [];
    for (const size of sizes) {
      for (const color of colors) {
        const tail = [size, color].filter(Boolean).map((v) => slug(String(v)).toUpperCase()).join("-");
        variants.push({
          sku: `${DEMO_PREFIX}-${p.key.toUpperCase()}${tail ? `-${tail}` : ""}`,
          size,
          color,
          priceCents: p.priceCents,
          stock: 25,
        });
      }
    }
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      category: p.category,
      tags: p.tags,
      images: [1, 2].map((n) => imageUrl(assetBaseUrl, `${p.name} ${n}`, 800, 1000)),
      variants,
    };
  });
}

export interface DemoOrder {
  orderNumber: string;
  status: "pending" | "processing" | "shipped" | "fulfilled" | "cancelled";
  productKey: string;
  variantIndex: number;
  quantity: number;
  daysAgo: number;
  trackingStatus: string | null;
  review: { rating: number; body: string } | null;
}

/** Past orders in varied states, all from the demo buyer to the demo seller. */
export const DEMO_ORDERS: DemoOrder[] = [
  { orderNumber: `${DEMO_PREFIX}-1001`, status: "fulfilled", productKey: "tee", variantIndex: 0, quantity: 2, daysAgo: 40, trackingStatus: "delivered", review: { rating: 5, body: "Great fit and the fabric feels premium." } },
  { orderNumber: `${DEMO_PREFIX}-1002`, status: "fulfilled", productKey: "hoodie", variantIndex: 1, quantity: 1, daysAgo: 25, trackingStatus: "delivered", review: { rating: 4, body: "Warm and well made. Runs slightly large." } },
  { orderNumber: `${DEMO_PREFIX}-1003`, status: "shipped", productKey: "cap", variantIndex: 0, quantity: 1, daysAgo: 4, trackingStatus: "in_transit", review: null },
  { orderNumber: `${DEMO_PREFIX}-1004`, status: "processing", productKey: "tote", variantIndex: 0, quantity: 1, daysAgo: 1, trackingStatus: null, review: null },
  { orderNumber: `${DEMO_PREFIX}-1005`, status: "cancelled", productKey: "socks", variantIndex: 0, quantity: 1, daysAgo: 12, trackingStatus: null, review: null },
];

export const DEMO_POSTS = [
  { key: "p1", caption: "New season basics are live. #atelierdemo", hashtags: ["atelierdemo", "basics"] },
  { key: "p2", caption: "Behind the scenes at the studio this week.", hashtags: ["studio"] },
  { key: "p3", caption: "Restocked: the Everyday Hoodie in charcoal.", hashtags: ["restock"] },
];

export function orderTotals(priceCents: number, quantity: number, status: DemoOrder["status"]) {
  const subtotalCents = priceCents * quantity;
  const shippingCents = 600;
  const totalCents = subtotalCents + shippingCents;
  return { subtotalCents, shippingCents, totalCents, paid: status !== "cancelled" && status !== "pending" };
}

export interface PlanSummary {
  users: number;
  products: number;
  variants: number;
  orders: number;
  reviews: number;
  posts: number;
  follows: number;
}

export function summarize(assetBaseUrl: string | null): PlanSummary {
  const products = buildProducts(assetBaseUrl);
  return {
    users: 2,
    products: products.length,
    variants: products.reduce((n, p) => n + p.variants.length, 0),
    orders: DEMO_ORDERS.length,
    reviews: DEMO_ORDERS.filter((o) => o.review).length,
    posts: DEMO_POSTS.length,
    follows: 1,
  };
}

/**
 * Fills {{REVIEW_DEMO_*}} placeholders in REVIEW_NOTES.md from env values.
 * Output is for pasting into App Store Connect / Play Console and must never
 * be written to a tracked file.
 */
export function renderNotes(template: string, env: DemoEnv, opts: RenderNotesOptions = {}): string {
  const withSections = applyLiveSection(template, opts.liveAvailable ?? true);
  const map: Record<string, string> = {
    REVIEW_DEMO_BUYER_EMAIL: env.buyerEmail,
    REVIEW_DEMO_BUYER_PASSWORD: env.buyerPassword,
    REVIEW_DEMO_SELLER_EMAIL: env.sellerEmail,
    REVIEW_DEMO_SELLER_PASSWORD: env.sellerPassword,
  };
  return withSections.replace(/\{\{(REVIEW_DEMO_[A-Z_]+)\}\}/g, (m, key: string) => map[key] ?? m);
}

export interface RenderNotesOptions {
  /** Agora configured on the production API (AGORA_APP_ID + AGORA_APP_CERTIFICATE).
   *  When false, the `<!-- if:live -->...<!-- endif:live -->` blocks are dropped
   *  so the reviewer is never told to Go Live (the app hides Go Live then). */
  liveAvailable?: boolean;
}

const LIVE_BLOCK = /<!-- if:live -->\n?([\s\S]*?)<!-- endif:live -->\n?/g;

/** Keeps (unwrapped) or removes the live-only sections of REVIEW_NOTES.md. */
export function applyLiveSection(template: string, liveAvailable: boolean): string {
  return template.replace(LIVE_BLOCK, (_m, body: string) => (liveAvailable ? body : ""));
}
