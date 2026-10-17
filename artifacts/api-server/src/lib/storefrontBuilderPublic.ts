/**
 * Public view of the Store Builder state saved on `storefronts` (migration 270):
 * collections, pages and navigation menus.
 *
 * The builder stores whatever the seller edits — drafts, hidden items, menu
 * entries that point at things which no longer exist. Buyers must only ever
 * see what the seller published, and collection product ids must resolve to
 * real, active products owned by that same seller. Everything here is pure
 * except `loadSellerCatalog` / `loadPublicBuilderData`.
 */
import { db, products, productVariants } from "@workspace/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { CANONICAL_WEB_ORIGIN } from "./webOrigin";

export interface CatalogProduct {
  id: string;
  name: string;
  image: string | null;
  priceCents: number;
  variantId: string;
  inStock: boolean;
  totalStock: number;
  category: string;
  tags: string[];
  isPreOrder: boolean;
  createdAt: Date;
}

export interface PublicCollection {
  id: string;
  name: string;
  description: string;
  handle: string;
  coverImageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  products: Array<Pick<CatalogProduct, "id" | "name" | "image" | "priceCents" | "variantId" | "inStock">>;
}

export interface PublicPage {
  id: string;
  type: string;
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface PublicNavItem {
  label: string;
  href: string | null;
  target: string;
  children: PublicNavItem[];
}

export interface PublicMenu {
  type: string;
  name: string;
  items: PublicNavItem[];
}

export interface PublicBuilderData {
  collections: PublicCollection[];
  pages: PublicPage[];
  navigation: PublicMenu[];
}

const MAX_COLLECTIONS = 20;
const MAX_PAGES = 30;
const MAX_PRODUCTS_PER_COLLECTION = 24;
const MAX_NAV_ITEMS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function optStr(v: unknown, max = 500): string | null {
  const s = str(v, max);
  return s ? s : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/** A builder item is live when it carries the live status, or was scheduled for a time that has passed. */
export function isLive(item: Record<string, unknown>, liveStatus: string, now: Date): boolean {
  const status = str(item.status, 40);
  if (status === liveStatus) return true;
  if (status === "scheduled") {
    const at = Date.parse(str(item.scheduledAt, 80));
    return Number.isFinite(at) && at <= now.getTime();
  }
  return false;
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

// ─── Collections ──────────────────────────────────────────────────────────────

function conditionMatches(p: CatalogProduct, cond: Record<string, unknown>, now: Date): boolean {
  const field = str(cond.field, 40);
  const op = str(cond.operator, 40);
  const raw = str(cond.value, 200);
  const value = raw.toLowerCase();
  const num = Number(raw);
  const compareText = (candidates: string[]): boolean => {
    const c = candidates.map((x) => x.toLowerCase());
    if (op === "is_set") return c.some((x) => x.length > 0);
    if (op === "equals") return c.includes(value);
    if (op === "contains") return value.length > 0 && c.some((x) => x.includes(value));
    return false;
  };
  const compareNum = (n: number): boolean => {
    if (op === "is_set") return true;
    if (!Number.isFinite(num)) return false;
    if (op === "equals") return n === num;
    if (op === "greater_than") return n > num;
    if (op === "less_than") return n < num;
    return false;
  };
  switch (field) {
    case "tag": return compareText(p.tags);
    case "category":
    case "product_type": return compareText([p.category]);
    case "price": return compareNum(p.priceCents / 100);
    case "inventory": return compareNum(p.totalStock);
    case "pre_order": return value === "false" || value === "no" ? !p.isPreOrder : p.isPreOrder;
    case "new_products": {
      const days = Number.isFinite(num) && num > 0 ? num : 30;
      return now.getTime() - p.createdAt.getTime() <= days * 86_400_000;
    }
    // Every product on a seller's storefront is the seller's own, and there is
    // no vendor column — never guess.
    default: return false;
  }
}

function sortProducts(list: CatalogProduct[], order: string, manualIds: string[]): CatalogProduct[] {
  const out = [...list];
  switch (order) {
    case "title_asc": return out.sort((a, b) => a.name.localeCompare(b.name));
    case "title_desc": return out.sort((a, b) => b.name.localeCompare(a.name));
    case "price_asc": return out.sort((a, b) => a.priceCents - b.priceCents);
    case "price_desc": return out.sort((a, b) => b.priceCents - a.priceCents);
    case "newest":
    case "best_selling": return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    default: {
      const pos = new Map(manualIds.map((id, i) => [id, i]));
      return out.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    }
  }
}

/** Resolve one collection's products from the seller's own catalog. */
export function selectCollectionProducts(
  col: Record<string, unknown>,
  catalog: CatalogProduct[],
  now: Date,
): CatalogProduct[] {
  const productIds = Array.isArray(col.productIds)
    ? col.productIds.filter((x): x is string => typeof x === "string")
    : [];
  let picked: CatalogProduct[];
  if (str(col.type, 20) === "automated") {
    const conditions = Array.isArray(col.conditions) ? col.conditions.map(obj).filter((c): c is Record<string, unknown> => !!c) : [];
    if (conditions.length === 0) return [];
    const any = str(col.conditionMatch, 10) === "any";
    picked = catalog.filter((p) => any
      ? conditions.some((c) => conditionMatches(p, c, now))
      : conditions.every((c) => conditionMatches(p, c, now)));
  } else {
    const wanted = new Set(productIds);
    picked = catalog.filter((p) => wanted.has(p.id));
  }
  return sortProducts(picked, str(col.productOrder, 20), productIds).slice(0, MAX_PRODUCTS_PER_COLLECTION);
}

export function publicCollections(raw: unknown, catalog: CatalogProduct[], now: Date): PublicCollection[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicCollection[] = [];
  const handles = new Set<string>();
  for (const item of raw) {
    const col = obj(item);
    if (!col || !isLive(col, "active", now)) continue;
    const name = str(col.name, 120) || str(col.title, 120);
    if (!name) continue;
    let handle = toSlug(str(col.handle, 80) || name) || `collection-${out.length + 1}`;
    while (handles.has(handle)) handle = `${handle}-${out.length + 1}`;
    handles.add(handle);
    const cover = col.coverImageUri ?? col.coverImage;
    out.push({
      id: str(col.id, 80) || handle,
      name,
      description: str(col.description, 2000),
      handle,
      coverImageUrl: isHttpUrl(cover) ? cover.trim() : null,
      seoTitle: optStr(col.seoTitle, 200),
      seoDescription: optStr(col.seoDescription, 400),
      products: selectCollectionProducts(col, catalog, now).map((p) => ({
        id: p.id, name: p.name, image: p.image, priceCents: p.priceCents, variantId: p.variantId, inStock: p.inStock,
      })),
    });
    if (out.length >= MAX_COLLECTIONS) break;
  }
  return out;
}

// ─── Pages ────────────────────────────────────────────────────────────────────

export function publicPages(raw: unknown, now: Date): PublicPage[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicPage[] = [];
  const slugs = new Set<string>();
  for (const item of raw) {
    const page = obj(item);
    if (!page || !isLive(page, "published", now)) continue;
    const title = str(page.title, 160);
    if (!title) continue;
    let slug = toSlug(str(page.slug, 80) || title) || `page-${out.length + 1}`;
    while (slugs.has(slug)) slug = `${slug}-${out.length + 1}`;
    slugs.add(slug);
    out.push({
      id: str(page.id, 80) || slug,
      type: str(page.type, 40) || "custom",
      title,
      slug,
      content: str(page.content ?? page.body, 20_000),
      seoTitle: optStr(page.seoTitle, 200),
      seoDescription: optStr(page.seoDescription, 400),
    });
    if (out.length >= MAX_PAGES) break;
  }
  return out;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Menu items reference collections/pages by id, handle/slug or name (the
 * builder's free-text field), products by id or name. Anything that does not
 * resolve to something published is dropped rather than linking nowhere.
 */
function resolveHref(
  item: Record<string, unknown>,
  ctx: { collections: PublicCollection[]; pages: PublicPage[]; catalog: CatalogProduct[] },
): string | null {
  const target = str(item.target, 30);
  const ref = str(item.targetId, 200);
  const refLower = ref.toLowerCase();
  if (target === "external") return isHttpUrl(item.url) ? String(item.url).trim() : null;
  if (!ref) return null;
  if (target === "collection") {
    const c = ctx.collections.find((x) => x.id === ref || x.handle === toSlug(ref) || x.name.toLowerCase() === refLower);
    return c ? `#collection-${c.handle}` : null;
  }
  if (target === "page") {
    const p = ctx.pages.find((x) => x.id === ref || x.slug === toSlug(ref) || x.title.toLowerCase() === refLower);
    return p ? `#page-${p.slug}` : null;
  }
  if (target === "product") {
    const p = ctx.catalog.find((x) => (UUID_RE.test(ref) && x.id === ref) || x.name.toLowerCase() === refLower);
    return p ? `${CANONICAL_WEB_ORIGIN}/store/product/${encodeURIComponent(p.id)}` : null;
  }
  return null;
}

function navItems(
  raw: unknown,
  ctx: { collections: PublicCollection[]; pages: PublicPage[]; catalog: CatalogProduct[] },
  depth: number,
): PublicNavItem[] {
  if (!Array.isArray(raw)) return [];
  const sorted = raw.map(obj).filter((x): x is Record<string, unknown> => !!x)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const out: PublicNavItem[] = [];
  for (const item of sorted) {
    if (item.visible === false) continue;
    const label = str(item.label, 80);
    if (!label) continue;
    const children = depth < 2 ? navItems(item.children, ctx, depth + 1) : [];
    const href = resolveHref(item, ctx);
    if (!href && children.length === 0) continue;
    out.push({ label, href, target: str(item.target, 30) || "none", children });
    if (out.length >= MAX_NAV_ITEMS) break;
  }
  return out;
}

export function publicNavigation(
  raw: unknown,
  ctx: { collections: PublicCollection[]; pages: PublicPage[]; catalog: CatalogProduct[] },
): PublicMenu[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicMenu[] = [];
  for (const m of raw) {
    const menu = obj(m);
    if (!menu) continue;
    const items = navItems(menu.items, ctx, 0);
    if (items.length === 0) continue;
    out.push({ type: str(menu.type, 20) || "main", name: str(menu.name, 80), items });
  }
  return out;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export function buildPublicBuilderData(
  sf: { collections?: unknown; pages?: unknown; navigation?: unknown },
  catalog: CatalogProduct[],
  now = new Date(),
): PublicBuilderData {
  const collections = publicCollections(sf.collections, catalog, now);
  const pages = publicPages(sf.pages, now);
  const navigation = publicNavigation(sf.navigation, { collections, pages, catalog });
  return { collections, pages, navigation };
}

/** The seller's active, non-deleted products with a priced variant. */
export async function loadSellerCatalog(ownerId: string, limit = 500): Promise<CatalogProduct[]> {
  const rows = await db
    .select({
      id: products.id, name: products.name, images: products.images, category: products.category,
      tags: products.tags, isPreOrder: products.isPreOrder, createdAt: products.createdAt,
    })
    .from(products)
    .where(and(eq(products.ownerId, ownerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .orderBy(desc(products.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const variants = await db
    .select({
      id: productVariants.id, productId: productVariants.productId,
      priceCents: productVariants.priceCents, stock: productVariants.stock,
    })
    .from(productVariants)
    .where(inArray(productVariants.productId, rows.map((r) => r.id)));
  const out: CatalogProduct[] = [];
  for (const p of rows) {
    const vs = variants.filter((v) => v.productId === p.id);
    if (vs.length === 0) continue;
    const v = vs.find((x) => x.stock > 0) ?? vs[0];
    const images = Array.isArray(p.images) ? (p.images as string[]) : [];
    out.push({
      id: p.id,
      name: p.name,
      image: images.length > 0 ? images[0] : null,
      priceCents: v.priceCents,
      variantId: v.id,
      inStock: vs.some((x) => x.stock > 0),
      totalStock: vs.reduce((n, x) => n + Math.max(0, x.stock), 0),
      category: p.category ?? "",
      tags: Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
      isPreOrder: Boolean(p.isPreOrder),
      createdAt: p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt as unknown as string),
    });
  }
  return out;
}

function needsCatalog(sf: { collections?: unknown; navigation?: unknown }): boolean {
  const hasCollections = Array.isArray(sf.collections) && sf.collections.length > 0;
  const hasProductLinks = JSON.stringify(sf.navigation ?? []).includes('"product"');
  return hasCollections || hasProductLinks;
}

/** Published collections (with real products), pages and menus for a storefront. */
export async function loadPublicBuilderData(
  ownerId: string,
  sf: { collections?: unknown; pages?: unknown; navigation?: unknown },
): Promise<PublicBuilderData> {
  const catalog = needsCatalog(sf) ? await loadSellerCatalog(ownerId) : [];
  return buildPublicBuilderData(sf, catalog);
}

/** Same as loadPublicBuilderData, but a lookup failure yields empty data instead of breaking the store page. */
export async function safePublicBuilderData(
  ownerId: string,
  sf: { collections?: unknown; pages?: unknown; navigation?: unknown },
): Promise<PublicBuilderData> {
  try {
    return await loadPublicBuilderData(ownerId, sf);
  } catch {
    return { collections: [], pages: [], navigation: [] };
  }
}

// ─── HTML (for /api/store/site/:slug) ─────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function navLink(item: PublicNavItem): string {
  const href = item.href ?? (item.children[0]?.href ?? "#");
  const external = /^https?:\/\//i.test(href) && !href.startsWith(CANONICAL_WEB_ORIGIN);
  return `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${esc(item.label)}</a>`;
}

function productCard(p: PublicCollection["products"][number]): string {
  const img = p.image && /^https?:\/\//i.test(p.image)
    ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">`
    : `<div class="product-image-placeholder" aria-hidden="true"></div>`;
  return `<article class="product-card">
              <div class="product-image">${img}</div>
              <div class="product-meta"><span>${esc(p.name)}</span><span>$${(Math.max(0, p.priceCents) / 100).toFixed(2)}</span></div>
              <button type="button" class="add-to-cart-btn" ${p.inStock ? "" : "disabled"}
                data-product-id="${esc(p.id)}" data-variant-id="${esc(p.variantId)}"
                data-name="${esc(p.name)}" data-price="${p.priceCents}" data-image="${esc(p.image ?? "")}">
                ${p.inStock ? "Add to cart" : "Sold out"}
              </button>
            </article>`;
}

/**
 * Markup fragments for the storefront page. `navLinks` / `footerLinks` are
 * null when the seller has no usable menu, so the page keeps its defaults.
 * Reuses the page's existing classes (collection, product-card, standard-section).
 */
export function renderBuilderHtml(data: PublicBuilderData): {
  navLinks: string | null;
  footerLinks: string | null;
  collectionsHtml: string;
  pagesHtml: string;
} {
  const main = data.navigation.find((m) => m.type === "main") ?? data.navigation.find((m) => m.type === "mobile");
  const footer = data.navigation.find((m) => m.type === "footer");
  const collectionsHtml = data.collections.map((c) => `<section class="collection" id="collection-${esc(c.handle)}">
        <div class="section-heading"><h2>${esc(c.name)}</h2><p>${esc(c.description)}</p></div>
        <div class="product-grid">${c.products.length > 0
          ? c.products.map(productCard).join("")
          : `<p class="empty-catalog">No products in this collection yet.</p>`}</div>
      </section>`).join("\n");
  const pagesHtml = data.pages.map((p) => {
    const paras = p.content.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
      .map((x) => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`).join("");
    return `<section class="standard-section" id="page-${esc(p.slug)}">
      <h2>${esc(p.title)}</h2>
      ${paras}
    </section>`;
  }).join("\n");
  return {
    navLinks: main ? main.items.map(navLink).join("") : null,
    footerLinks: footer ? footer.items.map(navLink).join(" ") : null,
    collectionsHtml,
    pagesHtml,
  };
}
